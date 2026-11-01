// Spec version 4: the parquet source and the Parquet type of a column (specs/005 FR-005, FR-009, FR-016,
// data-model.md, contracts/spec-file-v4.md). A Parquet spec holds structure only.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SPEC_VERSION } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";

const csvSource = { format: "csv", file_name: "t.csv", encoding: "utf-8", delimiter: ",", header: true };
const xlsxSource = { format: "xlsx", file_name: "t.xlsx", sheet: "S", skip_rows: 0, header: true, date1904: false };
const parquetSource = { format: "parquet", file_name: "survey.parquet", row_groups: 3 };
const quantiles = Array.from({ length: 101 }, (_, i) => 10 + i);

const spec = (source: unknown, columns: unknown[], over: Record<string, unknown> = {}) => ({ spec_version: 4, source, n_rows: 200, seed: 1, columns, ...over });
const int16 = { kind: "int", bits: 16, signed: true, nullable: true };
const amount = (over: Record<string, unknown> = {}) => ({ name: "amount", type: "float", mode: "match_shape", min: 10, max: 110, decimals: 2, quantiles, parquet_type: { kind: "decimal", precision: 10, scale: 2, nullable: true }, ...over });
const when = (over: Record<string, unknown> = {}) => ({ name: "when", type: "date", mode: "uniform", min: 19000, max: 19100, format: "%Y-%m-%d", granularity: "day", parquet_type: { kind: "date", nullable: false }, ...over });
const flag = (over: Record<string, unknown> = {}) => ({ name: "flag", type: "boolean", storage: "string", counts: { TRUE: 100, FALSE: 100 }, parquet_type: { kind: "bool", nullable: true }, ...over });
const count = (over: Record<string, unknown> = {}) => ({ name: "n", type: "integer", mode: "match_shape", min: 0, max: 100, decimals: 0, quantiles: Array.from({ length: 101 }, (_, i) => i), parquet_type: int16, ...over });

const messages = (s: unknown) => {
  const r = validateSpec(s);
  return r.ok ? [] : r.problems.map((p) => `${p.column ?? "-"}:${p.path}:${p.message}`);
};
const ok = (s: unknown) => {
  const r = validateSpec(s);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.spec;
};

describe("version 4", () => {
  it("is the version this app writes, and a parquet spec of it is valid", () => {
    expect(SPEC_VERSION).toBe(4);
    const s = ok(spec(parquetSource, [amount(), when(), flag(), count()]));
    expect(s.source).toEqual(parquetSource);
    expect(s.columns[0].parquet_type).toEqual({ kind: "decimal", precision: 10, scale: 2, nullable: true });
  });

  it("is refused in an older version label only by the version rules, not by the source", () => {
    expect(validateSpec(spec(parquetSource, [amount()], { spec_version: 5 })).ok).toBe(false);
  });
});

describe("the parquet source", () => {
  it.each([
    ["no file name", { format: "parquet", row_groups: 3 }],
    ["an empty file name", { format: "parquet", file_name: "", row_groups: 3 }],
    ["no row-group count", { format: "parquet", file_name: "a.parquet" }],
    ["a negative row-group count", { format: "parquet", file_name: "a.parquet", row_groups: -1 }],
    ["a fractional row-group count", { format: "parquet", file_name: "a.parquet", row_groups: 1.5 }],
  ])("refuses %s", (_name, source) => {
    expect(validateSpec(spec(source, [amount()])).ok).toBe(false);
  });

  it("holds nothing beyond the three fields: no creator, key-value text, compression or statistics", () => {
    for (const extra of [{ created_by: "x" }, { key_value_metadata: { a: "b" } }, { compression: "snappy" }, { statistics: { min: 1 } }, { sheet: "S" }]) {
      expect(validateSpec(spec({ ...parquetSource, ...extra }, [amount()])).ok, JSON.stringify(extra)).toBe(false);
    }
  });
});

describe("parquet_type on a column", () => {
  it("is needed on every column that is written", () => {
    const m = messages(spec(parquetSource, [amount({ parquet_type: undefined })]));
    expect(m.some((x) => x.includes("amount:parquet_type") && /needs its Parquet type/.test(x))).toBe(true);
  });

  it("is not needed on a dropped, an unsupported or an empty column", () => {
    const cols = [
      amount(),
      count({ name: "gone", exclude: "drop", parquet_type: undefined }),
      { name: "tags", type: "unsupported" },
      { name: "blank", type: "empty", na: { tokens: [""], count: 200 } },
    ];
    expect(messages(spec(parquetSource, cols))).toEqual([]);
  });

  it("is refused on a CSV or an Excel spec", () => {
    for (const source of [csvSource, xlsxSource]) {
      const m = messages(spec(source, [amount()]));
      expect(m.some((x) => /Only a spec for a Parquet file/.test(x)), source.format).toBe(true);
    }
  });

  it("must be well formed, and holds no value or statistic", () => {
    expect(messages(spec(parquetSource, [amount({ parquet_type: { kind: "decimal", precision: 50, scale: 2, nullable: true } })])).join(" ")).toMatch(/precision from 1 to 38/);
    expect(messages(spec(parquetSource, [amount({ parquet_type: { kind: "list", nullable: true } })])).join(" ")).toMatch(/kind is not one/);
    expect(messages(spec(parquetSource, [count({ parquet_type: { ...int16, min: 3 } })])).join(" ")).toMatch(/no field "min"/);
    expect(messages(spec(parquetSource, [count({ parquet_type: { ...int16, dictionary: ["a"] } })])).join(" ")).toMatch(/no field "dictionary"/);
  });

  it("must suit the column: dates for date columns, numbers for number columns", () => {
    expect(messages(spec(parquetSource, [when({ parquet_type: { kind: "int", bits: 32, signed: true, nullable: true } })])).join(" ")).toMatch(/date column needs a date/);
    expect(messages(spec(parquetSource, [amount({ parquet_type: { kind: "date", nullable: true } })])).join(" ")).toMatch(/number column needs an int/);
    expect(messages(spec(parquetSource, [flag({ parquet_type: { kind: "float", bits: 64, nullable: true } })])).join(" ")).toMatch(/yes\/no column needs/);
  });

  it("is refused on an unsupported column, which holds nothing from the file", () => {
    const m = messages(spec(parquetSource, [amount(), { name: "tags", type: "unsupported", parquet_type: { kind: "string", nullable: true } }]));
    expect(m.some((x) => x.includes("tags:parquet_type") && /holds nothing from the file/.test(x))).toBe(true);
    expect(messages(spec(parquetSource, [amount(), { name: "tags", type: "unsupported" }]))).toEqual([]);
  });

  it("lets text-typed files hold numbers and dates as strings", () => {
    const text = { kind: "string", nullable: true };
    expect(messages(spec(parquetSource, [amount({ parquet_type: text }), when({ parquet_type: text }), flag({ parquet_type: text })]))).toEqual([]);
  });
});

describe("older specs", () => {
  it("still load, and a CSV or Excel spec of version 4 writes its own format", () => {
    expect(validateSpec(spec(csvSource, [amount({ parquet_type: undefined })], { spec_version: 3 })).ok).toBe(true);
    expect(ok(spec(xlsxSource, [amount({ parquet_type: undefined })])).source.format).toBe("xlsx");
  });
});

describe("the JSON schema contract", () => {
  const schema = JSON.parse(readFileSync(join(__dirname, "../../specs/001-csv-synthetic-slice/contracts/spec-file.schema.json"), "utf8"));
  const text = JSON.stringify(schema);

  it("allows versions 1 to 4, the parquet source and the Parquet type, and no extra source fields", () => {
    expect(schema.properties.spec_version.enum).toEqual([1, 2, 3, 4]);
    const parquet = schema.properties.source.oneOf.find((s: { properties: { format: { const: string } } }) => s.properties.format.const === "parquet");
    expect(parquet.additionalProperties).toBe(false);
    expect(Object.keys(parquet.properties).sort()).toEqual(["file_name", "format", "row_groups"]);
    expect(text).toContain('"parquet_type"');
    expect(JSON.stringify(schema).includes("created_by")).toBe(false);
  });
});
