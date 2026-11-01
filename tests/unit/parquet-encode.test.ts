// @vitest-environment node
// How values are laid out in a Parquet data page (specs/005 research R3): PLAIN encoding for each physical
// type, bit-packed booleans, big-endian two's complement decimals, and the RLE / bit-packed hybrid for
// definition levels. Vectors follow the Parquet format specification.

import { describe, expect, it } from "vitest";
import { decimalBytesBE, encodeLevels, encodePlain } from "../../src/lib/parquet/encode";

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");

describe("encodePlain", () => {
  it("writes INT32 little endian, including an unsigned value above the signed range", () => {
    expect(hex(encodePlain("INT32", [1, -1, 256]))).toBe("01 00 00 00 ff ff ff ff 00 01 00 00");
    expect(hex(encodePlain("INT32", [4294967295]))).toBe("ff ff ff ff");
  });

  it("writes INT64 little endian from numbers or bigints, including an unsigned value above the signed range", () => {
    expect(hex(encodePlain("INT64", [1, -2n]))).toBe("01 00 00 00 00 00 00 00 fe ff ff ff ff ff ff ff");
    expect(hex(encodePlain("INT64", [2n ** 64n - 1n]))).toBe("ff ff ff ff ff ff ff ff");
    expect(hex(encodePlain("INT64", [2n ** 63n]))).toBe("00 00 00 00 00 00 00 80");
  });

  it("writes FLOAT and DOUBLE as IEEE little endian", () => {
    expect(hex(encodePlain("FLOAT", [1.5]))).toBe("00 00 c0 3f");
    expect(hex(encodePlain("DOUBLE", [1.5, -2]))).toBe("00 00 00 00 00 00 f8 3f 00 00 00 00 00 00 00 c0");
  });

  it("writes BYTE_ARRAY with a four byte length in front of each value", () => {
    expect(hex(encodePlain("BYTE_ARRAY", [new TextEncoder().encode("hi"), new Uint8Array(), Uint8Array.of(0xc3, 0xa9)]))).toBe("02 00 00 00 68 69 00 00 00 00 02 00 00 00 c3 a9");
  });

  it("writes FIXED_LEN_BYTE_ARRAY values back to back", () => {
    expect(hex(encodePlain("FIXED_LEN_BYTE_ARRAY", [Uint8Array.of(1, 2), Uint8Array.of(3, 4)], 2))).toBe("01 02 03 04");
  });

  it("refuses a fixed-length value of the wrong size", () => {
    expect(() => encodePlain("FIXED_LEN_BYTE_ARRAY", [Uint8Array.of(1, 2, 3)], 2)).toThrow(/2 bytes/);
  });

  it("packs booleans one bit each, lowest bit first", () => {
    expect(hex(encodePlain("BOOLEAN", [true, false, true, true, false, false, false, false]))).toBe("0d");
    expect(hex(encodePlain("BOOLEAN", [true, true, true, true, true, true, true, true, true]))).toBe("ff 01");
    expect(hex(encodePlain("BOOLEAN", []))).toBe("");
  });

  it("writes nothing for no values", () => {
    expect(encodePlain("INT32", []).length).toBe(0);
    expect(encodePlain("BYTE_ARRAY", []).length).toBe(0);
  });
});

describe("decimalBytesBE", () => {
  it("writes two's complement, big endian, padded to the length", () => {
    expect(hex(decimalBytesBE(1n, 2))).toBe("00 01");
    expect(hex(decimalBytesBE(-1n, 2))).toBe("ff ff");
    expect(hex(decimalBytesBE(256n, 3))).toBe("00 01 00");
    expect(hex(decimalBytesBE(-256n, 3))).toBe("ff ff 00");
    expect(hex(decimalBytesBE(127n, 1))).toBe("7f");
    expect(hex(decimalBytesBE(-128n, 1))).toBe("80");
  });

  it("holds the largest 38-digit decimal in 16 bytes", () => {
    const max = 10n ** 38n - 1n;
    const bytes = decimalBytesBE(max, 16);
    expect(bytes.length).toBe(16);
    let back = 0n;
    for (const b of bytes) back = (back << 8n) | BigInt(b);
    expect(back).toBe(max);
    const negative = decimalBytesBE(-max, 16);
    let value = 0n;
    for (const b of negative) value = (value << 8n) | BigInt(b);
    expect(BigInt.asIntN(128, value)).toBe(-max);
  });

  it("refuses a value that does not fit", () => {
    expect(() => decimalBytesBE(128n, 1)).toThrow(/does not fit/);
    expect(() => decimalBytesBE(-129n, 1)).toThrow(/does not fit/);
  });
});

describe("encodeLevels", () => {
  /** The level bytes without the four byte length prefix. */
  const body = (levels: ArrayLike<number | boolean>) => {
    const out = encodeLevels(levels);
    const length = new DataView(out.buffer, out.byteOffset, 4).getUint32(0, true);
    expect(length).toBe(out.length - 4);
    return out.subarray(4);
  };

  it("writes one RLE run when every value is defined", () => {
    // header (count << 1), then the value in one byte
    expect(hex(body(new Array(100).fill(1)))).toBe("c8 01 01");
    expect(hex(body([true, true, true]))).toBe("06 01");
  });

  it("writes one RLE run when every value is null", () => {
    expect(hex(body(new Array(10).fill(0)))).toBe("14 00");
  });

  it("bit-packs mixed levels in groups of eight, lowest bit first, padding the last group with zeros", () => {
    // groups = 1: header (1 << 1) | 1 = 03, then the byte
    expect(hex(body([1, 0, 1, 1, 0, 0, 0, 0]))).toBe("03 0d");
    expect(hex(body([1, 0, 1]))).toBe("03 05");
    expect(hex(body([1, 1, 1, 1, 1, 1, 1, 1, 0]))).toBe("05 ff 00");
  });

  it("round-trips through a reader of the hybrid format", () => {
    const levels = Array.from({ length: 1000 }, (_, i) => (i % 7 === 0 || i % 13 === 0 ? 0 : 1));
    const out = body(levels);
    // Read: a bit-packed run header, then ceil(count/8) bytes.
    let at = 0;
    let header = 0;
    let shift = 0;
    for (;;) {
      const b = out[at++];
      header |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7;
    }
    expect(header & 1).toBe(1);
    const groups = header >> 1;
    expect(groups).toBe(Math.ceil(1000 / 8));
    const decoded: number[] = [];
    for (let i = 0; i < 1000; i++) decoded.push((out[at + (i >> 3)] >> (i & 7)) & 1);
    expect(decoded).toEqual(levels);
  });

  it("writes an empty column as a zero-length body", () => {
    expect(hex(encodeLevels([]))).toBe("00 00 00 00");
  });
});
