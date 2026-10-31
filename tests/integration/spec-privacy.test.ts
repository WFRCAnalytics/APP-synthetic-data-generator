// @vitest-environment node
// FR-015, FR-019, SC-006: the spec for a table with 50,000 IDs holds no ID values and stays small.
// An ID column in the spec is a pattern, an optional min and max, and a repeat structure; nothing else.

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
let ids: Set<string>;
let json: string;

beforeAll(async () => {
  db = await createNodeDb();
  const path = join(ZOO, "ids_50k.csv");
  const raw = parseCsv(readFileSync(path, "utf8"));
  ids = new Set(raw.rows.slice(1).map((r) => r[0]));
  source = await profilePath(db, path);
  json = JSON.stringify(source.spec, null, 2);
}, 120_000);
afterAll(() => db?.close());

describe("the spec of a table with 50,000 IDs", () => {
  it("validates", () => {
    const result = validateSpec(source.spec);
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(result.ok).toBe(true);
  });

  it("is small (SC-006: under 1 MB; in practice a few kilobytes)", () => {
    expect(ids.size).toBe(50000);
    expect(json.length).toBeLessThan(1_000_000);
    expect(json.length).toBeLessThan(20_000);
  });

  it("holds none of the IDs as text", () => {
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(JSON.parse(json));
    expect(strings.filter((s) => ids.has(s))).toEqual([]);
  });

  it("describes the ID column by its pattern, range and repeat structure only", () => {
    const col = source.spec.columns.find((c) => c.name === "hh_id") as unknown as Record<string, unknown>;
    expect(Object.keys(col).sort()).toEqual(["mask", "min", "max", "name", "pad_width", "quoted", "repeat_structure", "type"].sort());
    expect(col.mask).toEqual(["digit", "digit", "digit", "digit", "digit"]);
    expect(Object.keys(col.repeat_structure as object).length).toBeLessThanOrEqual(4); // group sizes, not IDs
    expect(Object.keys(col.repeat_structure as object).every((k) => Number(k) <= 4)).toBe(true);
  });

  it("is one of very few arrays or objects with more than 20 entries (quantiles of numeric columns only)", () => {
    const big: string[] = [];
    const walk = (v: unknown, path: string) => {
      if (Array.isArray(v)) {
        if (v.length > 20) big.push(path);
        v.forEach((x, i) => walk(x, `${path}[${i}]`));
      } else if (v && typeof v === "object") {
        if (Object.keys(v).length > 20) big.push(path);
        Object.entries(v).forEach(([k, x]) => walk(x, `${path}.${k}`));
      }
    };
    walk(JSON.parse(json), "spec");
    // Only the 101 percentiles of the numeric column may be long; nothing under an ID column.
    expect(big.filter((p) => p.includes("hh_id") || p.includes("person_id"))).toEqual([]);
  });

  it("rejects a spec hand-edited to carry the IDs", () => {
    const evil = JSON.parse(json);
    const col = evil.columns.find((c: { name: string }) => c.name === "hh_id");
    col.values = [...ids].slice(0, 10);
    expect(validateSpec(evil).ok).toBe(false);
  });
});
