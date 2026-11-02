// @vitest-environment node
// Generating a JSON file from a spec alone (specs/007 FR-006, FR-007, FR-009, FR-012, acceptance scenarios 1.4, 1.5,
// 2.2, 2.3, 3.1 to 3.4): the file has the spec's keys, order, kinds and layout, exactly the recorded number of null
// values and absent keys, the same bytes for the same seed whatever the chunking, and nothing for an unsupported key.
// The result is read with an independent parser and with the engine's JSON reader.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CheckAccumulator } from "../../src/lib/generate/checks";
import { writeJson } from "../../src/lib/generate/json";
import { EMPTY_TEXT_TOKEN, SPEC_VERSION, type ColumnSpec, type SpecFile } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";
import { createNodeDb, type NodeDb } from "../helpers/duckdbNode";

const N = 400;
const q = (lo: number, hi: number) => Array.from({ length: 101 }, (_, i) => lo + ((hi - lo) * i) / 100);

const columns: ColumnSpec[] = [
  { name: "id", type: "survey_id", mask: [{ literal: "H" }, "digit", "digit", "digit", "digit"], repeat_structure: { "1": N }, json_kind: "string", json_missing: 0 },
  { name: "age", type: "integer", mode: "match_shape", min: 18, max: 90, mean: 45, sd: 15, decimals: 0, quantiles: q(18, 90), na: { tokens: [""], count: 40 }, json_kind: "number", json_missing: 15 },
  { name: "income", type: "float", mode: "match_shape", min: 1000, max: 90000, mean: 40000, sd: 9000, decimals: 2, quantiles: q(1000, 90000), json_kind: "number", json_missing: 0 },
  { name: "mode", type: "categorical", storage: "string", counts: { bus: 100, car: 200, walk: 70 }, na: { tokens: ["", EMPTY_TEXT_TOKEN], count: 30, by_token: { "": 20, [EMPTY_TEXT_TOKEN]: 10 } }, json_kind: "string", json_missing: 12 },
  { name: "ok", type: "boolean", storage: "string", counts: { TRUE: 150, FALSE: 250 }, json_kind: "boolean", json_missing: 0 },
  { name: "when", type: "date", mode: "uniform", min: 19000, max: 19400, format: "%Y-%m-%d", granularity: "day", json_kind: "string", json_missing: 0 },
  { name: "who", type: "personal", kind: "full_name", repeat_structure: { "1": N }, json_kind: "string", json_missing: 0 },
  { name: "inner", type: "unsupported", json_kind: "object", exclude: "drop" },
];

const spec = (source: Record<string, unknown> = {}, over: Partial<SpecFile> = {}): SpecFile =>
  ({
    spec_version: SPEC_VERSION,
    source: { format: "json", file_name: "t.json", form: "array", indent: "2", line_ending: "lf", trailing_newline: true, bom: false, ...source },
    n_rows: N,
    seed: 9,
    columns,
    ...over,
  }) as SpecFile;

async function build(s: SpecFile, seed = 9, chunkRows = 64) {
  const checks = (() => {
    const probe = writeJson(s, seed, chunkRows);
    return new CheckAccumulator(probe.plan);
  })();
  const run = writeJson(s, seed, chunkRows, (v) => checks.observeRow(v));
  const parts: Uint8Array[] = [];
  for await (const c of run.chunks) parts.push(c);
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return { bytes, text: new TextDecoder().decode(bytes), run, checks: [...checks.finish(), ...run.extraChecks()] };
}

let db: NodeDb;
beforeAll(async () => {
  db = await createNodeDb();
  await db.sql.run("LOAD json");
}, 60_000);
afterAll(() => db?.close());

describe("the spec", () => {
  it("is valid", () => {
    const r = validateSpec(spec());
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    expect(r.ok).toBe(true);
  });

  it("is refused as a JSON run when its source is not JSON", () => {
    const csv = spec({}, { source: { format: "csv", file_name: "t.csv", encoding: "utf-8", delimiter: ",", header: true } });
    expect(() => writeJson(csv, 1, 10)).toThrow();
  });
});

describe("the fake array", () => {
  it("has the spec's keys in order, one record per row, and leaves the unsupported key out", async () => {
    const { text } = await build(spec());
    const records = JSON.parse(text) as Record<string, unknown>[];
    expect(records).toHaveLength(N);
    for (const r of records) expect(Object.keys(r).every((k) => ["id", "age", "income", "mode", "ok", "when", "who"].includes(k))).toBe(true);
    expect(Object.keys(records[0])).toEqual(["id", "age", "income", "mode", "ok", "when", "who"].filter((k) => k in records[0]));
    expect(text).not.toContain('"inner"');
  });

  it("writes each key as its kind", async () => {
    const records = JSON.parse((await build(spec())).text) as Record<string, unknown>[];
    for (const r of records) {
      expect(typeof r.id).toBe("string");
      if (r.age !== null && "age" in r) expect(typeof r.age).toBe("number");
      expect(typeof r.income).toBe("number");
      expect(typeof r.ok).toBe("boolean");
      expect(r.when).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(records.filter((r) => r.ok === true)).toHaveLength(150);
  });

  it("keeps exactly the recorded number of nulls and absent keys, apart", async () => {
    const records = JSON.parse((await build(spec())).text) as Record<string, unknown>[];
    // age: 40 missing values, 15 of them absent keys and 25 null. mode: 20 missing values (and 10 of empty text), 12 absent and 8 null.
    expect(records.filter((r) => !("age" in r))).toHaveLength(15);
    expect(records.filter((r) => r.age === null)).toHaveLength(25);
    expect(records.filter((r) => !("mode" in r))).toHaveLength(12);
    expect(records.filter((r) => r.mode === null)).toHaveLength(8);
  });

  it("writes a cell of empty text as an empty string, not as a missing value", async () => {
    const records = JSON.parse((await build(spec())).text) as Record<string, unknown>[];
    expect(records.filter((r) => r.mode === "")).toHaveLength(10);
  });

  it("is the same bytes for the same seed, whatever the chunking, and different for another seed", async () => {
    const a = await build(spec(), 9, 64);
    const b = await build(spec(), 9, 1000);
    expect(b.text).toBe(a.text);
    expect((await build(spec(), 10)).text).not.toBe(a.text);
  });

  it("changing one key's settings leaves the others' values alone", async () => {
    const base = JSON.parse((await build(spec())).text) as Record<string, unknown>[];
    const changed = spec({}, { columns: columns.map((c) => (c.name === "income" ? { ...c, min: 2000, quantiles: q(2000, 90000) } : c)) as ColumnSpec[] });
    const other = JSON.parse((await build(changed)).text) as Record<string, unknown>[];
    for (const key of ["id", "age", "mode", "ok", "when", "who"]) expect(other.map((r) => r[key])).toEqual(base.map((r) => r[key]));
  });

  it("passes the check table", async () => {
    const { checks } = await build(spec());
    expect(checks.filter((c) => !c.pass)).toEqual([]);
  });

  it("is read by the engine's JSON reader", async () => {
    const { bytes } = await build(spec());
    db.registerBuffer("fake.json", bytes);
    const [r] = await db.sql.all("SELECT count(*) AS n FROM read_json_objects('fake.json', format = 'array')");
    expect(r.n).toBe(N);
  });
});

describe("layouts", () => {
  it("writes one record per line, with the recorded line ending and trailing newline", async () => {
    const lines = (await build(spec({ form: "lines", indent: "compact", line_ending: "crlf", trailing_newline: false }))).text;
    expect(lines.startsWith("[")).toBe(false);
    expect(lines.endsWith("}")).toBe(true);
    const parts = lines.split("\r\n");
    expect(parts).toHaveLength(N);
    for (const p of parts.slice(0, 5)) expect(() => JSON.parse(p)).not.toThrow();
  });

  it("writes the byte-order mark and the tab indent as recorded", async () => {
    const { bytes, text } = await build(spec({ bom: true, indent: "tab" }));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text.slice(0, 8)).toBe('[\n\t{\n\t\t"');
  });

  it("writes a compact array on one line", async () => {
    const { text } = await build(spec({ indent: "compact", trailing_newline: false }));
    expect(text.includes("\n")).toBe(false);
    expect(JSON.parse(text)).toHaveLength(N);
  });

  it("an array spec writes an array and a lines spec writes lines, never the other way round", async () => {
    expect((await build(spec({ form: "array" }))).text.startsWith("[")).toBe(true);
    expect((await build(spec({ form: "lines", indent: "compact" }))).text.startsWith("{")).toBe(true);
  });
});

describe("keys that are not written as values", () => {
  it("writes null in every record for a kept-as-missing key", async () => {
    const kept = spec({}, { columns: columns.map((c) => (c.name === "income" ? { ...c, exclude: "keep_as_na" } : c)) as ColumnSpec[] });
    const records = JSON.parse((await build(kept)).text) as Record<string, unknown>[];
    expect(records.every((r) => r.income === null)).toBe(true);
  });

  it("leaves a dropped key out and writes a kept unsupported key as null", async () => {
    const kept = spec({}, { columns: columns.map((c) => (c.name === "inner" ? { ...c, exclude: "keep_as_na" } : c)) as ColumnSpec[] });
    const records = JSON.parse((await build(kept)).text) as Record<string, unknown>[];
    expect(records.every((r) => r.inner === null)).toBe(true);
  });

  it("holds no real value: only fake text is written", async () => {
    const { text } = await build(spec());
    expect(text).not.toContain("PRIVATE-MARKER");
  });
});
