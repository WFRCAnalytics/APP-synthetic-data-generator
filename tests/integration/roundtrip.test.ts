// @vitest-environment node
// The format-fidelity promise (Principle IV, SC-004): the generated file must look the same to a
// parser as the original. Profile a real file, generate a fake one from the spec alone, then
// profile the fake one and compare. Run on the type zoo and on every dialect variant.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CheckAccumulator } from "../../src/lib/generate/checks";
import { planTable, rowValues } from "../../src/lib/generate/table";
import { validateSpec } from "../../src/lib/spec/validate";
import { detectFileSettings } from "../../src/workers/profile/open";
import { createNodeDb, type NodeDb } from "../helpers/duckdbNode";
import { parseCsv } from "../helpers/csvParse";
import { profileBytes, profilePath, renderSpec, type Profiled } from "../helpers/pipeline";

const ZOO = join(__dirname, "../fixtures/zoo");
let db: NodeDb;

beforeAll(async () => {
  db = await createNodeDb();
}, 60_000);
afterAll(() => db?.close());

describe("the type zoo", () => {
  let source: Profiled;
  let fake: Profiled;
  let bytes: Uint8Array;

  beforeAll(async () => {
    source = await profilePath(db, join(ZOO, "zoo_small.csv"));
    bytes = renderSpec(source.spec);
    fake = await profileBytes(db, bytes, "zoo_fake.csv");
  }, 120_000);

  it("builds a valid spec from the profiles", () => {
    const result = validateSpec(source.spec);
    if (!result.ok) throw new Error(JSON.stringify(result.problems, null, 1));
    expect(result.ok).toBe(true);
  });

  it("keeps the row count, the included columns and their order", () => {
    expect(fake.rowCount).toBe(source.rowCount);
    const included = source.profiles.filter((p) => p.exclude !== "drop").map((p) => p.name);
    expect(fake.columnNames).toEqual(included);
  });

  it("drops every unsupported column, so none of its values are in the output", () => {
    const text = new TextDecoder().decode(bytes);
    const dropped = source.profiles.filter((p) => p.exclude === "drop").map((p) => p.name);
    expect(dropped.length).toBeGreaterThan(15);
    const header = text.split("\n")[0].split(",");
    for (const name of dropped) expect(header).not.toContain(name);
  });

  it("is read back with the same type for every column (except those flagged near the threshold)", () => {
    const byName = new Map(fake.profiles.map((p) => [p.name, p]));
    const mismatches: string[] = [];
    for (const p of source.profiles) {
      if (p.exclude === "drop") continue;
      if (p.attentionReasons.includes("near_categorical_threshold")) continue; // may legitimately flip
      const got = byName.get(p.name)!;
      if (got.type !== p.type) mismatches.push(`${p.name}: ${p.type} -> ${got.type}`);
    }
    expect(mismatches).toEqual([]);
  });

  it("is read back with the same exact summaries for every supported column", () => {
    const byName = new Map(fake.profiles.map((p) => [p.name, p]));
    const problems: string[] = [];
    for (const p of source.profiles) {
      if (p.exclude === "drop" || p.attentionReasons.includes("near_categorical_threshold")) continue;
      const got = byName.get(p.name)!;
      if (got.type !== p.type) continue;
      if (got.naCount !== p.naCount) problems.push(`${p.name}: NA ${p.naCount} -> ${got.naCount}`);
      if (JSON.stringify(got.sentinels) !== JSON.stringify(p.sentinels)) problems.push(`${p.name}: sentinels differ`);
      const a = p.summary;
      const b = got.summary;
      if (a.kind === "categorical" && b.kind === "categorical") {
        if (JSON.stringify(Object.entries(a.counts).sort()) !== JSON.stringify(Object.entries(b.counts).sort())) problems.push(`${p.name}: label counts differ`);
      }
      if ((a.kind === "numeric" && b.kind === "numeric") || (a.kind === "datetime" && b.kind === "datetime")) {
        if (a.min !== b.min) problems.push(`${p.name}: min ${a.min} -> ${b.min}`);
        if (a.max !== b.max) problems.push(`${p.name}: max ${a.max} -> ${b.max}`);
        if (a.decimals !== b.decimals) problems.push(`${p.name}: decimals ${a.decimals} -> ${b.decimals}`);
      }
      if (a.kind === "datetime" && b.kind === "datetime" && a.format !== b.format) problems.push(`${p.name}: format ${a.format} -> ${b.format}`);
    }
    expect(problems).toEqual([]);
  });

  it("passes the check table for every column", () => {
    const plan = planTable(source.spec);
    const acc = new CheckAccumulator(plan);
    for (let r = 0; r < plan.nRows; r++) acc.observeRow(rowValues(plan, r));
    const checks = acc.finish();
    expect(checks.length).toBeGreaterThan(100);
    expect(checks.filter((c) => !c.pass).map((c) => `${c.column}.${c.metric}: ${c.target} vs ${c.achieved}`)).toEqual([]);
  });

  it("writes the same dialect it read", () => {
    const out = detectFileSettings(bytes.subarray(0, 1_000_000), bytes.subarray(-8), bytes.length).settings;
    expect(out).toEqual(source.settings);
  });

  it("produces the same bytes for the same seed and different bytes for another", () => {
    expect(renderSpec(source.spec, 42)).toEqual(bytes);
    expect(renderSpec(source.spec, 43)).not.toEqual(bytes);
  });

  it("never writes a real name, email or address (privacy)", () => {
    const text = new TextDecoder().decode(bytes);
    const raw = parseCsv(readFileSync(join(ZOO, "zoo_small.csv"), "utf8"));
    const header = raw.rows[0];
    for (const col of ["person_name", "email", "street_address", "ssn_like"]) {
      const idx = header.indexOf(col);
      for (const row of raw.rows.slice(1, 200)) expect(text.includes(row[idx])).toBe(false);
    }
  });
});

// Every dialect: delimiter, quoting, line ending, header, encoding, BOM, trailing newline.
describe("dialect variants", () => {
  const variants = [
    "variant_utf8.csv",
    "variant_utf8_bom.csv",
    "variant_utf16le.csv",
    "quote_all.csv",
    "quote_percolumn.csv",
    "delim_pipe.csv",
    "delim_tab.tsv",
    "eol_crlf.csv",
    "eol_cr.csv",
    "no_header.csv",
    "no_trailing_newline.csv",
  ];

  it.each(variants)("%s: the fake file has the same dialect, columns and row count", async (file) => {
    const source = await profilePath(db, join(ZOO, file));
    const bytes = renderSpec(source.spec);
    const fake = await profileBytes(db, bytes, `fake_${file}`);

    expect(fake.settings).toEqual(source.settings);
    expect(fake.rowCount).toBe(source.rowCount);
    expect(fake.columnNames.length).toBe(source.profiles.filter((p) => p.exclude !== "drop").length);
    if (source.settings.header) expect(fake.columnNames).toEqual(source.profiles.filter((p) => p.exclude !== "drop").map((p) => p.name));
    for (const p of fake.profiles) {
      const original = source.profiles.find((q) => q.name === p.name || fake.columnNames.indexOf(p.name) === source.columnNames.indexOf(q.name));
      expect(original).toBeDefined();
    }
  }, 60_000);

  it("quote_percolumn.csv: the same columns stay quoted", async () => {
    const source = await profilePath(db, join(ZOO, "quote_percolumn.csv"));
    const fake = await profileBytes(db, renderSpec(source.spec), "fake_percolumn.csv");
    // The note column is not written (free text is unsupported); the ID column is.
    const written = source.profiles.filter((p) => p.exclude !== "drop");
    expect(fake.profiles.map((p) => p.quoted)).toEqual(written.map((p) => p.quoted));
    expect(source.profiles.map((p) => p.quoted)).toEqual([false, true, false, true, true, true]);
    expect(written.map((p) => p.name)).toEqual(["id", "label", "amount", "when", "flag"]);
  });
});
