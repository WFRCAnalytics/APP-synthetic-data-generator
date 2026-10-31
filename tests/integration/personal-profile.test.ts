// Personal, free text and short string columns end to end (specs/002 FR-003, FR-004, FR-007, SC-001,
// SC-007): profile the real fixture, generate from the spec, profile the fake file, and compare what a
// parser would see. The fake file keeps the distinct count, the repeat structure, the missing counts
// and the lengths of the real one, and none of its values.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ColumnProfile } from "../../src/lib/profile/types";
import { createNodeDb, type NodeDb } from "../helpers/duckdbNode";
import { parseCsv } from "../helpers/csvParse";
import { profileBytes, profilePath, renderSpec, type Profiled } from "../helpers/pipeline";

const ZOO = join(__dirname, "../fixtures/zoo");
let db: NodeDb;

beforeAll(async () => {
  db = await createNodeDb();
}, 60_000);
afterAll(() => db?.close());

const repeatOf = (values: string[]) => {
  const per = new Map<string, number>();
  for (const v of values) per.set(v, (per.get(v) ?? 0) + 1);
  const structure: Record<string, number> = {};
  for (const n of per.values()) structure[n] = (structure[n] ?? 0) + 1;
  return structure;
};

describe("the type zoo's text columns", () => {
  let source: Profiled;
  let fake: Profiled;
  let realRows: string[][];
  let header: string[];
  let fakeRows: string[][];

  beforeAll(async () => {
    source = await profilePath(db, join(ZOO, "zoo_small.csv"));
    const bytes = renderSpec(source.spec);
    fake = await profileBytes(db, bytes, "fake_zoo.csv");
    const real = parseCsv(readFileSync(join(ZOO, "zoo_small.csv"), "utf8"));
    header = real.rows[0];
    realRows = real.rows.slice(1);
    fakeRows = parseCsv(new TextDecoder().decode(bytes)).rows;
  }, 120_000);

  const byName = (list: ColumnProfile[], name: string) => list.find((p) => p.name === name)!;
  const realColumn = (name: string) => realRows.map((r) => r[header.indexOf(name)]);
  const fakeColumn = (name: string) => fakeRows.slice(1).map((r) => r[fakeRows[0].indexOf(name)]);

  it.each(["email", "phone_us", "person_name", "first_name", "last_name", "street_address", "url", "ip_address"])("%s keeps its kind, distinct count and repeat structure", (name) => {
    const real = byName(source.profiles, name);
    const got = byName(fake.profiles, name);
    expect(real.type).toBe("personal");
    expect(got.type).toBe("personal");
    if (real.summary.kind !== "personal" || got.summary.kind !== "personal") throw new Error("expected personal summaries");
    expect(got.summary.personalKind).toBe(real.summary.personalKind);
    expect(got.summary.distinct).toBe(real.summary.distinct);
    expect(got.summary.repeatStructure).toEqual(real.summary.repeatStructure);
    expect(got.naCount).toBe(real.naCount);
  });

  it("never writes a real value of a personal column", () => {
    for (const name of ["email", "phone_us", "person_name", "street_address", "url", "ip_address", "first_name", "last_name"]) {
      const real = new Set(realColumn(name));
      const leaked = fakeColumn(name).filter((v) => real.has(v));
      expect(leaked, name).toEqual([]);
    }
  });

  it("an SSN-style column is not in the fake file until acknowledged", () => {
    expect(fakeRows[0]).not.toContain("ssn_like");
  });

  it("free text keeps its exact shortest and longest length and writes no real word", () => {
    for (const name of ["free_text", "comments"]) {
      const real = byName(source.profiles, name);
      const got = byName(fake.profiles, name);
      if (real.summary.kind !== "free_text" || got.summary.kind !== "free_text") throw new Error("expected free text");
      expect(got.summary.min).toBe(real.summary.min);
      expect(got.summary.max).toBe(real.summary.max);
      const realWords = new Set(realColumn(name).flatMap((v) => v.split(/[\s.,]+/)).filter((w) => w.length > 6));
      const fakeWords = new Set(fakeColumn(name).flatMap((v) => v.toLowerCase().split(/[\s.,]+/)).filter((w) => w.length > 6));
      expect([...fakeWords].filter((w) => realWords.has(w))).toEqual([]);
    }
  });

  it.each(["plate", "vendor_code", "short_code_many", "zip_text", "uuid", "currency_text", "percent_text"])("short string %s keeps its lengths, pattern and distinct count", (name) => {
    const real = byName(source.profiles, name);
    const got = byName(fake.profiles, name);
    if (real.summary.kind !== "short_string" || got.summary.kind !== "short_string") throw new Error(`${name} is not a short string`);
    expect(got.summary.distinct).toBe(real.summary.distinct);
    expect(got.summary.lengthGroups).toEqual(real.summary.lengthGroups);
    expect(got.summary.repeatStructure).toEqual(real.summary.repeatStructure);
    expect(got.naCount).toBe(real.naCount);
  });

  it("short strings of a pattern with fixed characters keep them", () => {
    const real = byName(source.profiles, "plate").summary;
    if (real.kind !== "short_string") throw new Error("expected short string");
    expect(real.pattern).toEqual(["upper", "upper", { literal: "-" }, "digit", "digit", "digit", "digit"]);
    for (const v of fakeColumn("plate")) expect(v).toMatch(/^[A-Z]{2}-\d{4}$/);
  });

  it("a column that mixes emails and text is flagged, and still generates", () => {
    const real = byName(source.profiles, "email_mixed");
    expect(real.status).toBe("needs_attention");
    expect(real.attentionReasons).toContain("kind_mixed");
    expect(fakeRows[0]).toContain("email_mixed");
  });

  it("the repeat structure of a real column is the one in the profile", () => {
    const real = byName(source.profiles, "person_name");
    if (real.summary.kind !== "personal") throw new Error("expected personal");
    const values = realColumn("person_name").filter((v) => v !== "");
    expect(real.summary.repeatStructure).toEqual(repeatOf(values));
  });
});

describe("50,000 distinct names (SC-001)", () => {
  it("the fake name column has the same distinct count and missing count", async () => {
    const source = await profilePath(db, join(ZOO, "text_50k.csv"));
    const name = source.profiles.find((p) => p.name === "respondent_name")!;
    expect(name.type).toBe("personal");
    if (name.summary.kind !== "personal") throw new Error("expected personal");
    expect(name.summary.distinct).toBeGreaterThanOrEqual(48_000); // 50,000 people, a few percent of the rows missing

    const bytes = renderSpec(source.spec);
    const fake = await profileBytes(db, bytes, "fake_text_50k.csv");
    const got = fake.profiles.find((p) => p.name === "respondent_name")!;
    if (got.summary.kind !== "personal") throw new Error("expected personal");
    expect(got.summary.distinct).toBe(name.summary.distinct);
    expect(got.summary.repeatStructure).toEqual(name.summary.repeatStructure);
    expect(got.naCount).toBe(name.naCount);
    expect(fake.rowCount).toBe(source.rowCount);

    // The other columns keep their counts as well, and the spec stays small (SC-005).
    for (const col of ["email", "phone", "address", "plate"]) {
      const a = source.profiles.find((p) => p.name === col)!.summary;
      const b = fake.profiles.find((p) => p.name === col)!.summary;
      if ((a.kind === "personal" || a.kind === "short_string") && (b.kind === "personal" || b.kind === "short_string")) expect(b.distinct, col).toBe(a.distinct);
    }
    expect(JSON.stringify(source.spec).length).toBeLessThan(100_000);
  }, 180_000);
});

describe("very long text (specs/002 edge case, research R13)", () => {
  it("counts a value of 150,000 characters at 100,000, says so, and still generates a valid column", async () => {
    // 80 different answers, one of them far too long.
    const rows = Array.from({ length: 80 }, (_, i) => `${i},${"w".repeat(10 + i)}${i === 40 ? "x".repeat(150000) : ""}`);
    const bytes = new TextEncoder().encode(`${["id,blob", ...rows].join("\n")}\n`);
    const source = await profileBytes(db, bytes, "long_text.csv");
    const blob = source.profiles.find((p) => p.name === "blob")!;
    expect(blob.type).toBe("free_text");
    if (blob.summary.kind !== "free_text") throw new Error("expected free text");
    expect(blob.summary.max).toBe(100000);
    expect(blob.attentionReasons).toContain("text_length_capped");
    expect(blob.status).toBe("needs_attention");

    const fake = await profileBytes(db, renderSpec(source.spec), "fake_long_text.csv");
    const got = fake.profiles.find((p) => p.name === "blob")!;
    if (got.summary.kind !== "free_text") throw new Error("expected free text");
    expect(got.summary.max).toBe(100000);
  }, 120_000);
});
