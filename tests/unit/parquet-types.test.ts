// @vitest-environment node
// The description of a Parquet column in the spec (specs/005 FR-005, data-model.md): what is valid, what
// physical storage each kind is written with, and the ranges that keep generated values inside the type.

import { describe, expect, it } from "vitest";
import { decimalBytes, decimalLimit, describeParquetType, intRange, physicalOf, validateParquetType, type ParquetType } from "../../src/lib/parquet/types";

const t = (over: Partial<ParquetType> & { kind: ParquetType["kind"] }): ParquetType => ({ nullable: true, ...over });

describe("validateParquetType", () => {
  it.each<[string, unknown]>([
    ["int16", { kind: "int", bits: 16, signed: true, nullable: true }],
    ["uint64", { kind: "int", bits: 64, signed: false, nullable: false }],
    ["float32", { kind: "float", bits: 32, nullable: true }],
    ["decimal(38,10)", { kind: "decimal", precision: 38, scale: 10, nullable: true }],
    ["decimal(5,0)", { kind: "decimal", precision: 5, scale: 0, nullable: true }],
    ["bool", { kind: "bool", nullable: true }],
    ["string", { kind: "string", nullable: false }],
    ["date", { kind: "date", nullable: true }],
    ["time", { kind: "time", unit: "ms", nullable: true }],
    ["timestamp", { kind: "timestamp", unit: "ns", utc: true, nullable: true }],
  ])("accepts %s", (_name, value) => {
    expect(validateParquetType(value)).toBeNull();
  });

  it.each<[string, unknown, RegExp]>([
    ["not an object", "int", /must be an object/],
    ["an array", [], /must be an object/],
    ["null", null, /must be an object/],
    ["an unknown kind", { kind: "list", nullable: true }, /kind is not one/],
    ["a missing nullable", { kind: "bool" }, /nullable/],
    ["bad int bits", { kind: "int", bits: 12, signed: true, nullable: true }, /bits of 8, 16, 32 or 64/],
    ["a missing signed", { kind: "int", bits: 16, nullable: true }, /signed/],
    ["bad float bits", { kind: "float", bits: 16, nullable: true }, /bits of 32 or 64/],
    ["precision 0", { kind: "decimal", precision: 0, scale: 0, nullable: true }, /precision from 1 to 38/],
    ["precision 39", { kind: "decimal", precision: 39, scale: 0, nullable: true }, /precision from 1 to 38/],
    ["a fractional precision", { kind: "decimal", precision: 5.5, scale: 0, nullable: true }, /precision/],
    ["scale above precision", { kind: "decimal", precision: 5, scale: 6, nullable: true }, /scale from 0 to its precision/],
    ["a negative scale", { kind: "decimal", precision: 5, scale: -1, nullable: true }, /scale/],
    ["a bad time unit", { kind: "time", unit: "s", nullable: true }, /unit of ms, us or ns/],
    ["a missing timestamp unit", { kind: "timestamp", utc: false, nullable: true }, /unit of ms, us or ns/],
    ["a missing utc flag", { kind: "timestamp", unit: "us", nullable: true }, /utc/],
    ["a stray field on a string", { kind: "string", nullable: true, max: "zzz" }, /no field "max"/],
    ["a value-like field on an int", { kind: "int", bits: 8, signed: true, nullable: true, min: 3 }, /no field "min"/],
  ])("refuses %s", (_name, value, message) => {
    expect(validateParquetType(value)).toMatch(message);
  });
});

describe("physicalOf", () => {
  it.each<[ParquetType, string, number | undefined]>([
    [t({ kind: "int", bits: 8, signed: true }), "INT32", undefined],
    [t({ kind: "int", bits: 32, signed: false }), "INT32", undefined],
    [t({ kind: "int", bits: 64, signed: true }), "INT64", undefined],
    [t({ kind: "float", bits: 32 }), "FLOAT", undefined],
    [t({ kind: "float", bits: 64 }), "DOUBLE", undefined],
    [t({ kind: "decimal", precision: 9, scale: 2 }), "INT32", undefined],
    [t({ kind: "decimal", precision: 10, scale: 2 }), "INT64", undefined],
    [t({ kind: "decimal", precision: 18, scale: 0 }), "INT64", undefined],
    [t({ kind: "decimal", precision: 19, scale: 0 }), "FIXED_LEN_BYTE_ARRAY", 9],
    [t({ kind: "decimal", precision: 38, scale: 10 }), "FIXED_LEN_BYTE_ARRAY", 16],
    [t({ kind: "bool" }), "BOOLEAN", undefined],
    [t({ kind: "string" }), "BYTE_ARRAY", undefined],
    [t({ kind: "date" }), "INT32", undefined],
    [t({ kind: "time", unit: "ms" }), "INT32", undefined],
    [t({ kind: "time", unit: "us" }), "INT64", undefined],
    [t({ kind: "timestamp", unit: "ms", utc: false }), "INT64", undefined],
  ])("writes %j as %s", (type, physical, typeLength) => {
    expect(physicalOf(type)).toEqual(typeLength === undefined ? { physical } : { physical, typeLength });
  });
});

describe("ranges", () => {
  it("gives the range of each integer width and sign", () => {
    expect(intRange(8, true)).toEqual({ min: -128n, max: 127n });
    expect(intRange(8, false)).toEqual({ min: 0n, max: 255n });
    expect(intRange(16, true)).toEqual({ min: -32768n, max: 32767n });
    expect(intRange(32, false)).toEqual({ min: 0n, max: 4294967295n });
    expect(intRange(64, true)).toEqual({ min: -(2n ** 63n), max: 2n ** 63n - 1n });
    expect(intRange(64, false)).toEqual({ min: 0n, max: 2n ** 64n - 1n });
  });

  it("gives the largest decimal of a precision and the bytes that hold it", () => {
    expect(decimalLimit(1)).toBe(9n);
    expect(decimalLimit(10)).toBe(9999999999n);
    expect(decimalLimit(38)).toBe(10n ** 38n - 1n);
    const expected: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 9: 4, 10: 5, 18: 8, 19: 9, 28: 12, 38: 16 };
    for (const [p, bytes] of Object.entries(expected)) expect(decimalBytes(Number(p)), `precision ${p}`).toBe(bytes);
  });

  it("holds every decimal of a precision, and the next size down would not", () => {
    for (let p = 1; p <= 38; p++) {
      const n = decimalBytes(p);
      expect(decimalLimit(p) <= 2n ** BigInt(8 * n - 1) - 1n, `p=${p} fits`).toBe(true);
      if (n > 1) expect(decimalLimit(p) > 2n ** BigInt(8 * (n - 1) - 1) - 1n, `p=${p} needs ${n}`).toBe(true);
    }
  });
});

describe("describeParquetType", () => {
  it("names each type for the card", () => {
    expect(describeParquetType(t({ kind: "int", bits: 16, signed: true }))).toBe("int16");
    expect(describeParquetType(t({ kind: "int", bits: 8, signed: false }))).toBe("uint8");
    expect(describeParquetType(t({ kind: "float", bits: 32 }))).toBe("float32");
    expect(describeParquetType(t({ kind: "decimal", precision: 10, scale: 2 }))).toBe("decimal(10,2)");
    expect(describeParquetType(t({ kind: "timestamp", unit: "us", utc: true }))).toBe("timestamp[us, UTC]");
    expect(describeParquetType(t({ kind: "timestamp", unit: "ms", utc: false }))).toBe("timestamp[ms]");
    expect(describeParquetType(t({ kind: "time", unit: "ns" }))).toBe("time[ns]");
    expect(describeParquetType(t({ kind: "string" }))).toBe("string");
    expect(describeParquetType(t({ kind: "bool" }))).toBe("boolean");
    expect(describeParquetType(t({ kind: "date" }))).toBe("date");
  });
});
