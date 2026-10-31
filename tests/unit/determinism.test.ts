// FR-020, FR-021, SC-004: the same spec and seed give the same bytes whatever the chunk size, a
// different seed gives a different file, and changing one column's settings changes no other column.

import { describe, expect, it } from "vitest";
import { renderAll } from "../../src/lib/generate/render";
import { planTable, rowValues } from "../../src/lib/generate/table";
import { SPEC_VERSION, type ColumnSpec, type SpecFile } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";

const N = 2500;
const quantiles = Array.from({ length: 101 }, (_, i) => 10 + i * 0.9);

const columns: ColumnSpec[] = [
  { name: "mode", type: "categorical", storage: "integer", counts: { "1": 1200, "2": 800, "97": 450 }, na: { tokens: ["", "NA"], count: 50, by_token: { "": 30, NA: 20 } } },
  { name: "fee", type: "float", mode: "match_shape", min: 10, max: 100, mean: 55, sd: 26, decimals: 2, quantiles, sentinels: { "-9": 25 }, na: { tokens: [""], count: 25 } },
  { name: "spread", type: "float", mode: "match_mean_sd", min: 0, max: 50, mean: 20, sd: 8, decimals: 1 },
  { name: "flat", type: "integer", mode: "uniform", min: 1, max: 12, decimals: 0 },
  { name: "when", type: "date", mode: "uniform", min: 19000, max: 19100, decimals: 0, format: "%Y-%m-%d", granularity: "day" },
  { name: "hh_id", type: "survey_id", mask: ["digit", "digit", "digit", "digit", "digit"], min: 10000, max: 99999, pad_width: 0, repeat_structure: { "1": 1500, "2": 500 } },
  { name: "site", type: "survey_id", mask: ["upper", { literal: "-" }, "digit", "digit"], repeat_structure: { "1": 2500 } },
  { name: "flag", type: "boolean", storage: "string", counts: { N: 1700, Y: 800 } },
];

const spec = (cols: ColumnSpec[] = columns, over: Partial<SpecFile> = {}): SpecFile => ({
  spec_version: SPEC_VERSION,
  source: { format: "csv", file_name: "t.csv", encoding: "utf-8", delimiter: ",", quote: '"', header: true },
  n_rows: N,
  seed: 42,
  columns: cols,
  ...over,
});

const bytes = (s: SpecFile, seed?: number, chunk?: number) => renderAll(planTable(s, seed), chunk);
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const cells = (s: SpecFile, seed = 42) => {
  const plan = planTable(s, seed);
  return Array.from({ length: N }, (_, r) => rowValues(plan, r));
};

describe("the fixture spec is valid", () => {
  it("passes validation", () => {
    const r = validateSpec(spec());
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    expect(r.ok).toBe(true);
  });
});

describe("the same spec and seed", () => {
  it("give identical bytes on every run", () => {
    expect(same(bytes(spec()), bytes(spec()))).toBe(true);
  });

  it.each([1, 7, 999, 2500, 5000, 100000])("give identical bytes with %i rows per chunk", (chunk) => {
    expect(same(bytes(spec(), undefined, chunk), bytes(spec(), undefined, 5000))).toBe(true);
  });

  it("use the seed argument over the seed saved in the spec", () => {
    expect(same(bytes(spec(columns, { seed: 1 }), 42), bytes(spec(columns, { seed: 99 }), 42))).toBe(true);
  });

  it("give a different file for a different seed", () => {
    expect(same(bytes(spec(), 42), bytes(spec(), 43))).toBe(false);
  });
});

describe("changing one column changes no other (per-column sub-seeds)", () => {
  const base = cells(spec());
  const index = (name: string) => columns.findIndex((c) => c.name === name);

  const changed = (name: string, edit: (c: ColumnSpec) => ColumnSpec) => cells(spec(columns.map((c) => (c.name === name ? edit(c) : c))));
  const othersUnchanged = (after: string[][], name: string) => {
    for (const c of columns) {
      if (c.name === name) continue;
      const i = index(c.name);
      expect(after.map((r) => r[i]), `column ${c.name}`).toEqual(base.map((r) => r[i]));
    }
  };

  it("a new numeric mode and range for one column", () => {
    const after = changed("fee", (c) => ({ ...(c as ColumnSpec & { mode: string }), mode: "uniform", min: 20, max: 80 }) as ColumnSpec);
    othersUnchanged(after, "fee");
    expect(after.map((r) => r[index("fee")])).not.toEqual(base.map((r) => r[index("fee")]));
  });

  it("different category counts for one column", () => {
    const after = changed("flag", (c) => ({ ...c, counts: { N: 1000, Y: 1500 } }) as ColumnSpec);
    othersUnchanged(after, "flag");
  });

  it("a wider ID pattern for one column", () => {
    const after = changed("site", () => ({ name: "site", type: "survey_id", mask: ["upper", "upper", { literal: "-" }, "digit", "digit"], repeat_structure: { "1": 2500 } }) as ColumnSpec);
    othersUnchanged(after, "site");
  });

  it("leaving a column out", () => {
    const after = cells(spec(columns.filter((c) => c.name !== "spread")));
    for (const c of columns) {
      if (c.name === "spread") continue;
      const was = base.map((r) => r[index(c.name)]);
      const now = after.map((r) => r[columns.filter((x) => x.name !== "spread").findIndex((x) => x.name === c.name)]);
      expect(now, `column ${c.name}`).toEqual(was);
    }
  });

  it("renaming a column does not change its own values either", () => {
    const after = cells(spec(columns.map((c) => (c.name === "flag" ? { ...c, output_name: "answer" } : c))));
    expect(after).toEqual(base);
  });
});
