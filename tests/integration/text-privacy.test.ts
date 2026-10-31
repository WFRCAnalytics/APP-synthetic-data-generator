// @vitest-environment node
// The spec of a table with 50,000 distinct names holds none of them (specs/002 FR-009, SC-002, SC-005):
// no name, email, phone, address, plate or word from the data, and it stays small. A spec edited by hand
// to carry values is refused, naming the column.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateSpec } from "../../src/lib/spec/validate";
import { createNodeDb, type NodeDb } from "../helpers/duckdbNode";
import { parseCsv } from "../helpers/csvParse";
import { profilePath, type Profiled } from "../helpers/pipeline";

const ZOO = join(__dirname, "../fixtures/zoo");
let db: NodeDb;
let source: Profiled;
let json: string;
let realValues: Set<string>;
let realWords: Set<string>;

const SPLIT = /[\s.,@()-]+/;

beforeAll(async () => {
  db = await createNodeDb();
  const path = join(ZOO, "text_50k.csv");
  const raw = parseCsv(readFileSync(path, "utf8"));
  realValues = new Set(raw.rows.slice(1).flat().filter((v) => v.length > 3));
  realWords = new Set([...realValues].flatMap((v) => v.split(SPLIT)).filter((w) => w.length > 5));
  source = await profilePath(db, path);
  json = JSON.stringify(source.spec, null, 2);
}, 180_000);
afterAll(() => db?.close());

describe("the spec of the 50,000-name table", () => {
  it("validates", () => {
    const r = validateSpec(source.spec);
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    expect(r.ok).toBe(true);
  });

  it("is small: under 100 KB (SC-005)", () => {
    expect(json.length).toBeLessThan(100_000);
  });

  it("holds none of the real values, and none of their words", () => {
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(JSON.parse(json));
    expect(strings.filter((s) => realValues.has(s))).toEqual([]);
    for (const s of strings) for (const w of s.split(SPLIT)) expect(realWords.has(w), `the spec holds the word ${w}`).toBe(false);
  });

  it("describes each text column by kind, repeat structure and counts only", () => {
    const who = source.spec.columns.find((c) => c.name === "respondent_name") as unknown as Record<string, unknown>;
    expect(who.type).toBe("personal");
    expect(Object.keys(who).every((k) => ["name", "type", "kind", "na", "quoted", "repeat_structure", "format"].includes(k))).toBe(true);
    const plate = source.spec.columns.find((c) => c.name === "plate") as unknown as Record<string, unknown>;
    expect(Object.keys(plate).sort()).toEqual(["length_groups", "name", "pattern", "quoted", "repeat_structure", "type"].sort());
  });
});

describe("a spec edited to carry values is refused", () => {
  const withKey = (name: string, key: string, value: unknown) => {
    const edited = JSON.parse(json);
    edited.columns.find((c: { name: string }) => c.name === name)[key] = value;
    return validateSpec(edited);
  };

  it.each([
    ["respondent_name", "values", ["Jane Doe"]],
    ["email", "counts", { "a@b.c": 1 }],
    ["plate", "values", ["AB-1234"]],
    ["respondent_name", "labels", ["x"]],
  ])("%s with a %s list", (name, key, value) => {
    const r = withKey(name, key, value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.some((p) => p.column === name)).toBe(true);
  });

  it("a phone shape that carries real digits", () => {
    const edited = JSON.parse(json);
    const phone = edited.columns.find((c: { name: string }) => c.name === "phone");
    phone.format = { shapes: [{ shape: "(801) 555-0000", share: 1 }] };
    expect(validateSpec(edited).ok).toBe(false);
  });
});
