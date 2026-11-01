// @vitest-environment node
// Generating a Parquet file from a spec alone (specs/005 FR-006, FR-007, FR-008, FR-014, acceptance scenarios
// 1.4, 1.5, 2.1 to 2.4): the file has the spec's names, order and types, the recorded number of missing values,
// values inside each type's range, the same cells for the same seed whatever the chunking, and a check row for
// anything that had to be narrowed. The result is opened with the engine's reader.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CheckAccumulator } from "../../src/lib/generate/checks";
import { writeParquet } from "../../src/lib/generate/parquet";
import { EMPTY_TEXT_TOKEN, SPEC_VERSION, type ColumnSpec, type SpecFile } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";
import type { ParquetType } from "../../src/lib/parquet/types";
import { CREATED_BY_PREFIX } from "../../src/lib/parquet/writer";
import { createNodeDb, type NodeDb } from "../helpers/duckdbNode";

const N = 400;
const q = (lo: number, hi: number) => Array.from({ length: 101 }, (_, i) => lo + ((hi - lo) * i) / 100);
const pt = (type: Omit<ParquetType, "nullable"> & { nullable?: boolean }): ParquetType => ({ nullable: true, ...type });

const columns: ColumnSpec[] = [
  { name: "resp_id", type: "survey_id", mask: ["digit", "digit", "digit", "digit", "digit"], pad_width: 5, min: 0, max: 99999, repeat_structure: { "1": N }, parquet_type: pt({ kind: "string", nullable: false }) },
  { name: "small", type: "integer", mode: "match_shape", min: 0, max: 5000, mean: 2500, sd: 1000, decimals: 0, quantiles: q(0, 5000), parquet_type: pt({ kind: "int", bits: 8, signed: true }) },
  { name: "amount", type: "float", mode: "match_shape", min: 10, max: 500, mean: 200, sd: 90, decimals: 2, quantiles: q(10, 500), na: { tokens: [""], count: 20 }, parquet_type: pt({ kind: "decimal", precision: 6, scale: 2 }) },
  { name: "when", type: "date", mode: "uniform", min: 19000, max: 19400, format: "%Y-%m-%d", granularity: "day", parquet_type: pt({ kind: "date", nullable: false }) },
  { name: "stamp", type: "datetime", mode: "uniform", min: 19000 * 86400, max: 19400 * 86400, format: "%Y-%m-%d %H:%M:%S", granularity: "second", parquet_type: pt({ kind: "timestamp", unit: "us", utc: true }) },
  { name: "flag", type: "categorical", storage: "string", counts: { N: 130, Y: 130 }, na: { tokens: ["", EMPTY_TEXT_TOKEN], count: 140, by_token: { "": 90, [EMPTY_TEXT_TOKEN]: 50 } }, parquet_type: pt({ kind: "string" }) },
  { name: "who", type: "personal", kind: "full_name", repeat_structure: { "1": N }, parquet_type: pt({ kind: "string" }) },
  { name: "ok", type: "boolean", storage: "string", counts: { TRUE: 200, FALSE: 200 }, parquet_type: pt({ kind: "bool" }) },
  { name: "tags", type: "unsupported", exclude: "drop" },
];

const spec = (over: Partial<SpecFile> = {}): SpecFile => ({
  spec_version: SPEC_VERSION,
  source: { format: "parquet", file_name: "t.parquet", row_groups: 2 },
  n_rows: N,
  seed: 9,
  columns,
  ...over,
});

async function build(s: SpecFile, seed = 9, chunkRows = 64) {
  const run = writeParquet(s, seed, chunkRows, { createdBy: `${CREATED_BY_PREFIX} test`, codec: "gzip", rowGroupRows: 150 });
  const checks = new CheckAccumulator(run.plan);
  const observed = writeParquet(s, seed, chunkRows, { createdBy: `${CREATED_BY_PREFIX} test`, codec: "gzip", rowGroupRows: 150 }, (v) => checks.observeRow(v));
  const parts: Uint8Array[] = [];
  for await (const c of observed.chunks) parts.push(c);
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return { bytes, run: observed, checks: [...checks.finish(), ...observed.extraChecks()] };
}

let db: NodeDb;
beforeAll(async () => {
  db = await createNodeDb();
  await db.sql.run("LOAD parquet");
}, 60_000);
afterAll(() => db?.close());

describe("the spec", () => {
  it("is valid", () => {
    const r = validateSpec(spec());
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    expect(r.ok).toBe(true);
  });

  it("is refused as a Parquet run when its source is not Parquet", () => {
    const csv = spec({ source: { format: "csv", file_name: "t.csv", encoding: "utf-8", delimiter: ",", header: true } });
    expect(() => writeParquet(csv, 1, 10, { createdBy: "x", codec: "none" })).toThrow();
  });
});

describe("the fake file", () => {
  it("has the spec's names, order and types, and leaves the unsupported column out", async () => {
    const { bytes } = await build(spec());
    db.registerBuffer("a.parquet", bytes);
    const described = await db.sql.all("DESCRIBE SELECT * FROM read_parquet('a.parquet')");
    expect(described.map((r) => [r.column_name, r.column_type])).toEqual([
      ["resp_id", "VARCHAR"], ["small", "TINYINT"], ["amount", "DECIMAL(6,2)"], ["when", "DATE"], ["stamp", "TIMESTAMP WITH TIME ZONE"], ["flag", "VARCHAR"], ["who", "VARCHAR"], ["ok", "BOOLEAN"],
    ]);
    const schema = await db.sql.all("SELECT name, repetition_type FROM parquet_schema('a.parquet') WHERE name IN ('resp_id', 'when', 'amount')");
    expect(Object.fromEntries(schema.map((r) => [r.name, r.repetition_type]))).toEqual({ resp_id: "REQUIRED", when: "REQUIRED", amount: "OPTIONAL" });
  });

  it("has the recorded number of missing values, blank apart from empty text", async () => {
    const { bytes } = await build(spec());
    db.registerBuffer("b.parquet", bytes);
    const [r] = await db.sql.all(`SELECT count(*) AS n, count(*) FILTER (WHERE amount IS NULL) AS amount_nulls, count(*) FILTER (WHERE flag IS NULL) AS flag_nulls, count(*) FILTER (WHERE flag = '') AS flag_empty FROM read_parquet('b.parquet')`);
    expect(r).toEqual({ n: N, amount_nulls: 20, flag_nulls: 90, flag_empty: 50 });
  });

  it("keeps values inside each type's range and counts what it narrowed", async () => {
    const { bytes, checks } = await build(spec());
    db.registerBuffer("c.parquet", bytes);
    const [r] = await db.sql.all(`SELECT min(small) AS lo, max(small) AS hi, CAST(max(amount) AS DOUBLE) AS top FROM read_parquet('c.parquet')`);
    expect(r.lo).toBeGreaterThanOrEqual(-128);
    expect(r.hi).toBe(127);
    expect(r.top).toBeLessThanOrEqual(500);
    const narrowed = checks.find((c) => c.column === "small" && c.metric === "narrowed");
    expect(narrowed).toBeDefined();
    expect(Number(narrowed!.achieved)).toBeGreaterThan(100); // most of 0 to 5,000 does not fit a signed byte
    expect(narrowed!.pass).toBe(false);
    expect(checks.some((c) => c.column === "amount" && c.metric === "narrowed")).toBe(false); // 10 to 500 fits 6 digits
  });

  it("has no narrowed row when every value fits", async () => {
    const fits = spec({ columns: columns.filter((c) => c.name !== "small" && c.name !== "tags") });
    const { checks } = await build(fits);
    expect(checks.filter((c) => c.metric === "narrowed" || c.metric === "unparsed")).toEqual([]);
  });

  it("gives the same cells for the same seed whatever the chunking, and other cells for another seed", async () => {
    const dump = async (name: string, bytes: Uint8Array) => {
      db.registerBuffer(name, bytes);
      return JSON.stringify(await db.sql.all(`SELECT resp_id, small, CAST(amount AS VARCHAR) AS amount, CAST("when" AS VARCHAR) AS d, flag, who, ok FROM read_parquet('${name}') ORDER BY resp_id`));
    };
    const a = await dump("d1.parquet", (await build(spec(), 9, 64)).bytes);
    const b = await dump("d2.parquet", (await build(spec(), 9, 1000)).bytes);
    const c = await dump("d3.parquet", (await build(spec(), 10, 64)).bytes);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it("is the same bytes for the same seed and the same settings", async () => {
    const a = (await build(spec())).bytes;
    const b = (await build(spec())).bytes;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("writes a kept-as-missing column as a column of nulls under its name", async () => {
    const kept = spec({ columns: columns.map((c) => (c.name === "tags" ? { ...c, exclude: "keep_as_na" as const } : c)) });
    const { bytes } = await build(kept);
    db.registerBuffer("e.parquet", bytes);
    const [r] = await db.sql.all(`SELECT count(*) AS n, count(tags) AS values_in_tags FROM read_parquet('e.parquet')`);
    expect(r).toEqual({ n: N, values_in_tags: 0 });
  });

  it("makes a required column optional when it has to hold missing values", async () => {
    const odd = spec({ columns: columns.map((c) => (c.name === "amount" ? { ...c, parquet_type: pt({ kind: "decimal", precision: 6, scale: 2, nullable: false }) } : c)) });
    const { bytes } = await build(odd);
    db.registerBuffer("f.parquet", bytes);
    const schema = await db.sql.all("SELECT repetition_type FROM parquet_schema('f.parquet') WHERE name = 'amount'");
    expect(schema[0].repetition_type).toBe("OPTIONAL");
  });

  it("stops when the progress hook throws, as a cancel does", async () => {
    const run = writeParquet(spec(), 9, 50, { createdBy: "x", codec: "none" }, undefined, (done) => {
      if (done >= 100) throw new Error("cancelled");
    });
    await expect((async () => { for await (const chunk of run.chunks) void chunk; })()).rejects.toThrow("cancelled");
  });
});
