// @vitest-environment node
// The Thrift compact protocol writer that produces Parquet's footer and page headers (specs/005 research
// R3). Byte vectors follow the Thrift compact protocol specification.

import { describe, expect, it } from "vitest";
import { TType, ThriftWriter, varint, zigzag } from "../../src/lib/parquet/thrift";

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");

describe("varint and zigzag", () => {
  it("writes unsigned varints, seven bits at a time", () => {
    expect(hex(Uint8Array.from(varint(0n)))).toBe("00");
    expect(hex(Uint8Array.from(varint(1n)))).toBe("01");
    expect(hex(Uint8Array.from(varint(127n)))).toBe("7f");
    expect(hex(Uint8Array.from(varint(128n)))).toBe("80 01");
    expect(hex(Uint8Array.from(varint(300n)))).toBe("ac 02");
    expect(hex(Uint8Array.from(varint(2n ** 63n)))).toBe("80 80 80 80 80 80 80 80 80 01");
  });

  it("maps signed numbers to unsigned by zigzag", () => {
    expect([0n, -1n, 1n, -2n, 2n].map((v) => zigzag(v))).toEqual([0n, 1n, 2n, 3n, 4n]);
    expect(zigzag(-(2n ** 63n))).toBe(2n ** 64n - 1n);
    expect(zigzag(2n ** 63n - 1n)).toBe(2n ** 64n - 2n);
  });
});

describe("ThriftWriter", () => {
  it("writes an i32 field with a delta header, and the stop byte at the end", () => {
    const w = new ThriftWriter();
    w.structBegin();
    w.fieldI32(1, 1);
    w.fieldI32(2, -1);
    w.structEnd();
    expect(hex(w.finish())).toBe("15 02 15 01 00");
  });

  it("writes a long delta as the type byte then the zigzag field id", () => {
    const w = new ThriftWriter();
    w.structBegin();
    w.fieldI32(20, 5);
    w.structEnd();
    expect(hex(w.finish())).toBe("05 28 0a 00");
  });

  it("writes booleans in the field header", () => {
    const w = new ThriftWriter();
    w.structBegin();
    w.fieldBool(1, true);
    w.fieldBool(2, false);
    w.structEnd();
    expect(hex(w.finish())).toBe("11 12 00");
  });

  it("writes i64 as a zigzag varint, from a number or a bigint", () => {
    const w = new ThriftWriter();
    w.structBegin();
    w.fieldI64(1, 150);
    w.fieldI64(2, -(2n ** 40n));
    w.structEnd();
    // 150 zigzags to 300 (ac 02); -(2^40) zigzags to 2^41 - 1 (five 0xff bytes then 0x3f)
    expect(hex(w.finish())).toBe("16 ac 02 16 ff ff ff ff ff 3f 00");
  });

  it("writes a one-byte integer as a raw byte", () => {
    const w = new ThriftWriter();
    w.structBegin();
    w.fieldByte(1, 16);
    w.fieldByte(2, 8);
    w.structEnd();
    expect(hex(w.finish())).toBe("13 10 13 08 00");
  });

  it("writes strings and binary with a varint length", () => {
    const w = new ThriftWriter();
    w.structBegin();
    w.fieldString(1, "hi");
    w.fieldBinary(2, Uint8Array.of(1, 2, 3));
    w.structEnd();
    expect(hex(w.finish())).toBe("18 02 68 69 18 03 01 02 03 00");
  });

  it("writes UTF-8 for a string with accents", () => {
    const w = new ThriftWriter();
    w.structBegin();
    w.fieldString(1, "é");
    w.structEnd();
    expect(hex(w.finish())).toBe("18 02 c3 a9 00");
  });

  it("writes a list of i32 with the size and element type in one byte", () => {
    const w = new ThriftWriter();
    w.structBegin();
    w.fieldListBegin(1, TType.I32, 3);
    w.i32(1);
    w.i32(2);
    w.i32(3);
    w.structEnd();
    expect(hex(w.finish())).toBe("19 35 02 04 06 00");
  });

  it("writes a long list size after a 0xf marker", () => {
    const w = new ThriftWriter();
    w.structBegin();
    w.fieldListBegin(1, TType.I32, 15);
    for (let i = 0; i < 15; i++) w.i32(0);
    w.structEnd();
    expect(hex(w.finish()).startsWith("19 f5 0f 00")).toBe(true);
  });

  it("writes nested structs, each with its own field-id deltas and stop byte", () => {
    const w = new ThriftWriter();
    w.structBegin();
    w.fieldStructBegin(1);
    w.fieldI32(1, 1);
    w.structEnd();
    w.fieldI32(2, 1);
    w.structEnd();
    // outer field 1 is a struct (0x1c), inner i32 field 1 (0x15 02), inner stop, then outer field 2 (delta 1) i32
    expect(hex(w.finish())).toBe("1c 15 02 00 15 02 00");
  });

  it("writes a list of structs", () => {
    const w = new ThriftWriter();
    w.structBegin();
    w.fieldListBegin(4, TType.STRUCT, 2);
    for (let i = 0; i < 2; i++) {
      w.structBegin();
      w.fieldI32(1, i);
      w.structEnd();
    }
    w.structEnd();
    expect(hex(w.finish())).toBe("49 2c 15 00 00 15 02 00 00");
  });

  it("writes a list of strings", () => {
    const w = new ThriftWriter();
    w.structBegin();
    w.fieldListBegin(1, TType.BINARY, 2);
    w.string("a");
    w.string("bc");
    w.structEnd();
    expect(hex(w.finish())).toBe("19 28 01 61 02 62 63 00");
  });

  it("restores the field-id delta after a nested struct", () => {
    const w = new ThriftWriter();
    w.structBegin();
    w.fieldI32(3, 1);
    w.fieldStructBegin(4);
    w.fieldI32(1, 1);
    w.structEnd();
    w.fieldI32(5, 1);
    w.structEnd();
    expect(hex(w.finish())).toBe("35 02 1c 15 02 00 15 02 00");
  });

  it("grows past its first buffer", () => {
    const w = new ThriftWriter();
    w.structBegin();
    w.fieldBinary(1, new Uint8Array(100_000).fill(7));
    w.structEnd();
    const out = w.finish();
    expect(out.length).toBe(1 + 3 + 100_000 + 1);
    expect(out[out.length - 1]).toBe(0);
  });

  it("refuses a field written outside a struct, or a stop with none open", () => {
    expect(() => new ThriftWriter().fieldI32(1, 1)).toThrow(/struct/);
    expect(() => new ThriftWriter().structEnd()).toThrow(/struct/);
  });
});
