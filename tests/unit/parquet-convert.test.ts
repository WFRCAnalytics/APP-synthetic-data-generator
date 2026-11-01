// @vitest-environment node
// From the cell text the generators produce to typed Parquet values (specs/005 research R6, R6b, FR-006,
// FR-007): parsing, clamping into the type's range with a count, nulls, empty text, and exact 64-bit and
// 38-digit values through BigInt.

import { describe, expect, it } from "vitest";
import { createConverter } from "../../src/lib/parquet/convert";
import { EMPTY_TEXT_TOKEN } from "../../src/lib/spec/types";
import type { ParquetType } from "../../src/lib/parquet/types";

const conv = (type: Omit<ParquetType, "nullable"> & { nullable?: boolean }) => createConverter({ nullable: true, ...type });
const bytes = (v: unknown) => Array.from(v as Uint8Array);

describe("nulls and empty text", () => {
  it("makes a blank cell a null for every kind", () => {
    for (const type of [
      { kind: "int", bits: 32, signed: true },
      { kind: "float", bits: 64 },
      { kind: "decimal", precision: 5, scale: 2 },
      { kind: "bool" },
      { kind: "string" },
      { kind: "date" },
      { kind: "time", unit: "us" },
      { kind: "timestamp", unit: "us", utc: false },
    ] as const) {
      expect(conv(type).convert(""), type.kind).toBeNull();
    }
  });

  it("makes the empty-text token an empty string for a string column and a null for the others", () => {
    expect(bytes(conv({ kind: "string" }).convert(EMPTY_TEXT_TOKEN))).toEqual([]);
    expect(conv({ kind: "int", bits: 8, signed: true }).convert(EMPTY_TEXT_TOKEN)).toBeNull();
    expect(conv({ kind: "date" }).convert(EMPTY_TEXT_TOKEN)).toBeNull();
  });

  it("writes strings as UTF-8", () => {
    expect(bytes(conv({ kind: "string" }).convert("é x"))).toEqual([0xc3, 0xa9, 0x20, 0x78]);
  });
});

describe("integers", () => {
  it("parses whole numbers, as numbers up to 32 bits and bigints at 64", () => {
    expect(conv({ kind: "int", bits: 16, signed: true }).convert("-123")).toBe(-123);
    expect(conv({ kind: "int", bits: 32, signed: false }).convert("4000000000")).toBe(4000000000);
    expect(conv({ kind: "int", bits: 64, signed: true }).convert("42")).toBe(42n);
  });

  it("is exact beyond 2^53", () => {
    expect(conv({ kind: "int", bits: 64, signed: true }).convert("9223372036854775807")).toBe(9223372036854775807n);
    expect(conv({ kind: "int", bits: 64, signed: true }).convert("-9223372036854775808")).toBe(-9223372036854775808n);
    expect(conv({ kind: "int", bits: 64, signed: false }).convert("18446744073709551615")).toBe(18446744073709551615n);
  });

  it("clamps into the range of the width and sign, and counts each value it narrowed", () => {
    const c = conv({ kind: "int", bits: 8, signed: true });
    expect(c.convert("300")).toBe(127);
    expect(c.convert("-300")).toBe(-128);
    expect(c.convert("5")).toBe(5);
    expect(c.stats).toEqual({ narrowed: 2, unparsed: 0 });
    const u = conv({ kind: "int", bits: 16, signed: false });
    expect(u.convert("-4")).toBe(0);
    expect(u.convert("70000")).toBe(65535);
    expect(u.stats.narrowed).toBe(2);
  });

  it("rounds a value with a fractional part, and counts what is not a number", () => {
    const c = conv({ kind: "int", bits: 32, signed: true });
    expect(c.convert("12.0")).toBe(12);
    expect(c.convert("12.6")).toBe(13);
    expect(c.convert("abc")).toBeNull();
    expect(c.convert("NA")).toBeNull();
    expect(c.stats).toEqual({ narrowed: 0, unparsed: 2 });
  });
});

describe("floats", () => {
  it("parses numbers, including exponents", () => {
    expect(conv({ kind: "float", bits: 64 }).convert("3.25")).toBe(3.25);
    expect(conv({ kind: "float", bits: 32 }).convert("-1e3")).toBe(-1000);
  });

  it("counts what is not a number as unparsed", () => {
    const c = conv({ kind: "float", bits: 64 });
    expect(c.convert("x")).toBeNull();
    expect(c.convert("NaN")).toBeNull();
    expect(c.stats.unparsed).toBe(2);
  });
});

describe("decimals", () => {
  it("scales to the recorded scale: small precision as a number, up to 18 as a bigint", () => {
    expect(conv({ kind: "decimal", precision: 9, scale: 2 }).convert("123.45")).toBe(12345);
    expect(conv({ kind: "decimal", precision: 9, scale: 2 }).convert("-0.5")).toBe(-50);
    expect(conv({ kind: "decimal", precision: 9, scale: 0 }).convert("7")).toBe(7);
    expect(conv({ kind: "decimal", precision: 18, scale: 3 }).convert("1.5")).toBe(1500n);
  });

  it("rounds extra digits half away from zero", () => {
    const c = conv({ kind: "decimal", precision: 9, scale: 2 });
    expect(c.convert("1.005")).toBe(101);
    expect(c.convert("1.004")).toBe(100);
    expect(c.convert("-1.005")).toBe(-101);
  });

  it("writes wide decimals as big-endian bytes, exactly", () => {
    const out = conv({ kind: "decimal", precision: 38, scale: 10 }).convert("12345678901234567890.1234567890") as Uint8Array;
    expect(out.length).toBe(16);
    let v = 0n;
    for (const b of out) v = (v << 8n) | BigInt(b);
    expect(BigInt.asIntN(128, v)).toBe(123456789012345678901234567890n);
  });

  it("clamps to the precision and counts the narrowing", () => {
    const c = conv({ kind: "decimal", precision: 5, scale: 2 });
    expect(c.convert("123456.78")).toBe(99999);
    expect(c.convert("-123456.78")).toBe(-99999);
    expect(c.stats.narrowed).toBe(2);
  });

  it("reads an exponent form, and counts what is not a number", () => {
    const c = conv({ kind: "decimal", precision: 9, scale: 2 });
    expect(c.convert("1.5e2")).toBe(15000);
    expect(c.convert("abc")).toBeNull();
    expect(c.stats.unparsed).toBe(1);
  });
});

describe("booleans", () => {
  it("reads TRUE and FALSE in any case, and 1 and 0", () => {
    const c = conv({ kind: "bool" });
    expect([c.convert("TRUE"), c.convert("false"), c.convert("1"), c.convert("0")]).toEqual([true, false, true, false]);
    expect(c.convert("maybe")).toBeNull();
    expect(c.stats.unparsed).toBe(1);
  });
});

describe("dates, times and timestamps", () => {
  it("writes a date as days since 1970", () => {
    const c = conv({ kind: "date" });
    expect(c.convert("1970-01-01")).toBe(0);
    expect(c.convert("1970-01-02")).toBe(1);
    expect(c.convert("1969-12-31")).toBe(-1);
    expect(c.convert("2024-02-29")).toBe(19782);
    expect(c.convert("0001-01-01")).toBe(-719162);
    expect(c.convert("9999-12-31")).toBe(2932896);
  });

  it("ignores a time part on a date, and counts what is not a date", () => {
    const c = conv({ kind: "date" });
    expect(c.convert("2024-02-29 13:45:00")).toBe(19782);
    expect(c.convert("29/02/2024")).toBeNull();
    expect(c.convert("2023-02-30")).toBeNull();
    expect(c.stats.unparsed).toBe(2);
  });

  it("writes a time in its unit, as a number for milliseconds and a bigint otherwise", () => {
    expect(conv({ kind: "time", unit: "ms" }).convert("01:00:00")).toBe(3_600_000);
    expect(conv({ kind: "time", unit: "ms" }).convert("00:00:01.250")).toBe(1250);
    expect(conv({ kind: "time", unit: "us" }).convert("00:00:01.000123")).toBe(1_000_123n);
    expect(conv({ kind: "time", unit: "ns" }).convert("23:59:59.999999999")).toBe(86_399_999_999_999n);
  });

  it("writes a timestamp in its unit since the epoch, exactly", () => {
    expect(conv({ kind: "timestamp", unit: "ms", utc: false }).convert("1970-01-01 00:00:01")).toBe(1000n);
    expect(conv({ kind: "timestamp", unit: "us", utc: true }).convert("2021-05-01 08:30:00")).toBe(1_619_857_800_000_000n);
    expect(conv({ kind: "timestamp", unit: "ns", utc: false }).convert("2021-05-01T08:30:00.123456789")).toBe(1_619_857_800_123_456_789n);
    expect(conv({ kind: "timestamp", unit: "us", utc: false }).convert("1969-12-31 23:59:59.5")).toBe(-500_000n);
  });

  it("takes a date alone as midnight, and a trailing Z or +00:00 as UTC", () => {
    expect(conv({ kind: "timestamp", unit: "ms", utc: true }).convert("1970-01-02")).toBe(86_400_000n);
    expect(conv({ kind: "timestamp", unit: "ms", utc: true }).convert("1970-01-01 00:00:01Z")).toBe(1000n);
    expect(conv({ kind: "timestamp", unit: "ms", utc: true }).convert("1970-01-01 00:00:01+00:00")).toBe(1000n);
  });

  it("counts a time or timestamp it cannot read", () => {
    const t = conv({ kind: "time", unit: "ms" });
    expect(t.convert("25:00:00")).toBeNull();
    expect(t.convert("noon")).toBeNull();
    const s = conv({ kind: "timestamp", unit: "ms", utc: false });
    expect(s.convert("yesterday")).toBeNull();
    expect(t.stats.unparsed + s.stats.unparsed).toBe(3);
  });
});
