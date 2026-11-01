// @vitest-environment node
// From the engine's description of a Parquet file to column types (specs/005 FR-005, FR-008, research R4):
// every supported type, nullability from the repetition, each unsupported kind with its fixed reason, and
// the walk of the schema tree that finds the top-level columns. Rows here are shaped like the real
// `parquet_schema` output (checked against pyarrow files in tests/integration/parquet-load.test.ts).

import { describe, expect, it } from "vitest";
import { mapColumn, topLevelRows, type SchemaRow } from "../../src/lib/parquet/schema";

const row = (over: Partial<SchemaRow> = {}): SchemaRow => ({
  name: "c",
  type: "INT32",
  converted_type: null,
  logical_type: null,
  type_length: null,
  scale: null,
  precision: null,
  repetition_type: "OPTIONAL",
  num_children: null,
  ...over,
});

const ts = (unit: "MILLIS=MilliSeconds()" | "MICROS=MicroSeconds()" | "NANOS=NanoSeconds()", utc: 0 | 1) =>
  `TimestampType(isAdjustedToUTC=${utc}, unit=TimeUnit(${unit.startsWith("MILLIS") ? unit : "MILLIS=<null>"}, ${unit.startsWith("MICROS") ? unit : "MICROS=<null>"}, ${unit.startsWith("NANOS") ? unit : "NANOS=<null>"}))`;

describe("mapColumn: supported types", () => {
  it.each<[string, string, Partial<SchemaRow>, object]>([
    ["TINYINT", "int8", {}, { kind: "int", bits: 8, signed: true }],
    ["SMALLINT", "int16", { converted_type: "INT_16" }, { kind: "int", bits: 16, signed: true }],
    ["INTEGER", "int32", {}, { kind: "int", bits: 32, signed: true }],
    ["BIGINT", "int64", { type: "INT64" }, { kind: "int", bits: 64, signed: true }],
    ["UTINYINT", "uint8", { converted_type: "UINT_8" }, { kind: "int", bits: 8, signed: false }],
    ["USMALLINT", "uint16", {}, { kind: "int", bits: 16, signed: false }],
    ["UINTEGER", "uint32", {}, { kind: "int", bits: 32, signed: false }],
    ["UBIGINT", "uint64", { type: "INT64" }, { kind: "int", bits: 64, signed: false }],
    ["FLOAT", "float32", { type: "FLOAT" }, { kind: "float", bits: 32 }],
    ["DOUBLE", "float64", { type: "DOUBLE" }, { kind: "float", bits: 64 }],
    ["DECIMAL(10,2)", "decimal", { type: "FIXED_LEN_BYTE_ARRAY", converted_type: "DECIMAL", precision: 10, scale: 2 }, { kind: "decimal", precision: 10, scale: 2 }],
    ["DECIMAL(38, 10)", "decimal with a space", {}, { kind: "decimal", precision: 38, scale: 10 }],
    ["BOOLEAN", "bool", { type: "BOOLEAN" }, { kind: "bool" }],
    ["VARCHAR", "string", { type: "BYTE_ARRAY", converted_type: "UTF8", logical_type: "StringType()" }, { kind: "string" }],
    ["ENUM('a', 'b')", "enum", {}, { kind: "string" }],
    ["DATE", "date", { converted_type: "DATE" }, { kind: "date" }],
  ])("%s is %s", (duck, _name, over, expected) => {
    const result = mapColumn(duck, row(over));
    expect(result).toEqual({ ok: true, type: { ...expected, nullable: true } });
  });

  it("reads the unit and zone flag of a timestamp from the logical type, then keeps nothing of it", () => {
    const us = mapColumn("TIMESTAMP", row({ type: "INT64", logical_type: ts("MICROS=MicroSeconds()", 0) }));
    expect(us).toEqual({ ok: true, type: { kind: "timestamp", unit: "us", utc: false, nullable: true } });
    const msZone = mapColumn("TIMESTAMP WITH TIME ZONE", row({ type: "INT64", logical_type: ts("MILLIS=MilliSeconds()", 1) }));
    expect(msZone).toEqual({ ok: true, type: { kind: "timestamp", unit: "ms", utc: true, nullable: true } });
    const ns = mapColumn("TIMESTAMP_NS", row({ type: "INT64", logical_type: ts("NANOS=NanoSeconds()", 0) }));
    expect(ns).toEqual({ ok: true, type: { kind: "timestamp", unit: "ns", utc: false, nullable: true } });
    expect(JSON.stringify([us, msZone, ns])).not.toMatch(/TimestampType|isAdjusted|TimeUnit/);
  });

  it("falls back to the engine's type, and to nanoseconds for legacy 96-bit timestamps", () => {
    expect(mapColumn("TIMESTAMP_MS", row({ type: "INT64" }))).toMatchObject({ ok: true, type: { unit: "ms" } });
    expect(mapColumn("TIMESTAMP", row({ type: "INT64" }))).toMatchObject({ ok: true, type: { unit: "us" } });
    expect(mapColumn("TIMESTAMP", row({ type: "INT96" }))).toMatchObject({ ok: true, type: { unit: "ns", utc: false } });
  });

  it("reads the unit of a time column", () => {
    expect(mapColumn("TIME", row({ type: "INT64", converted_type: "TIME_MILLIS" }))).toMatchObject({ ok: true, type: { kind: "time", unit: "ms" } });
    expect(mapColumn("TIME", row({ type: "INT64", logical_type: "TimeType(isAdjustedToUTC=0, unit=TimeUnit(MILLIS=<null>, MICROS=<null>, NANOS=NanoSeconds()))" }))).toMatchObject({ type: { unit: "ns" } });
    expect(mapColumn("TIME", row({ type: "INT64" }))).toMatchObject({ type: { unit: "us" } });
  });

  it("takes nullability from the repetition", () => {
    expect(mapColumn("INTEGER", row({ repetition_type: "REQUIRED" }))).toMatchObject({ type: { nullable: false } });
    expect(mapColumn("INTEGER", row({ repetition_type: "OPTIONAL" }))).toMatchObject({ type: { nullable: true } });
  });

  it("does not care about the case of the engine's type", () => {
    expect(mapColumn("smallint", row())).toMatchObject({ ok: true, type: { bits: 16 } });
  });
});

describe("mapColumn: unsupported types", () => {
  it.each<[string, Partial<SchemaRow>, string]>([
    ["VARCHAR[]", {}, "nested_list"],
    ["INTEGER[3]", {}, "nested_list"],
    ["STRUCT(x INTEGER, y INTEGER)", {}, "nested_struct"],
    ["MAP(VARCHAR, INTEGER)", {}, "nested_map"],
    ["UNION(num INTEGER, str VARCHAR)", {}, "nested_union"],
    ["BLOB", { type: "BYTE_ARRAY" }, "binary"],
    ["BLOB", { type: "FIXED_LEN_BYTE_ARRAY", type_length: 16 }, "binary"],
    ["BLOB", { type: "FIXED_LEN_BYTE_ARRAY", logical_type: "UUIDType()" }, "uuid"],
    ["UUID", {}, "uuid"],
    ["INTERVAL", {}, "interval"],
    ["HUGEINT", {}, "other"],
    ["BIT", {}, "other"],
  ])("%s is unsupported (%s)", (duck, over, reason) => {
    expect(mapColumn(duck, row(over))).toEqual({ ok: false, reason });
  });
});

describe("topLevelRows", () => {
  const root = (n: number) => row({ name: "schema", type: null, repetition_type: "REQUIRED", num_children: n });

  it("returns the columns of a flat schema in order", () => {
    const rows = [root(3), row({ name: "a" }), row({ name: "b" }), row({ name: "c" })];
    expect(topLevelRows(rows).map((r) => r.name)).toEqual(["a", "b", "c"]);
  });

  it("skips everything under a nested column, however deep", () => {
    const rows = [
      root(4),
      row({ name: "id" }),
      row({ name: "tags", type: null, num_children: 1 }),
      row({ name: "list", type: null, repetition_type: "REPEATED", num_children: 1 }),
      row({ name: "element" }),
      row({ name: "pt", type: null, num_children: 2 }),
      row({ name: "x" }),
      row({ name: "inner", type: null, num_children: 1 }),
      row({ name: "deep" }),
      row({ name: "last" }),
    ];
    expect(topLevelRows(rows).map((r) => r.name)).toEqual(["id", "tags", "pt", "last"]);
  });

  it("returns nothing for an empty schema or a root with no children", () => {
    expect(topLevelRows([])).toEqual([]);
    expect(topLevelRows([root(0)])).toEqual([]);
  });
});
