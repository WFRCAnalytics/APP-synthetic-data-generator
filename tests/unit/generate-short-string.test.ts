// Generating short string columns (specs/002 FR-007, FR-013, research R7a): every value fits the pattern
// at its length, each length has exactly its recorded number of distinct values, the repeat structure
// is exact, and a pattern too narrow for its column is refused.

import { describe, expect, it } from "vitest";
import { CheckAccumulator } from "../../src/lib/generate/checks";
import { GenerationError } from "../../src/lib/generate/column";
import { renderAll } from "../../src/lib/generate/render";
import { planTable, rowValues } from "../../src/lib/generate/table";
import { makeShortStringGenerator, ShortStringError } from "../../src/lib/textgen/shortstring";
import { SPEC_VERSION, type ColumnSpec, type MaskToken, type SpecFile } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";

const N = 5000;
const pattern: MaskToken[] = ["upper", "upper", { literal: "-" }, "digit", "digit", "digit", "digit"];

const plate = (over: Record<string, unknown> = {}): ColumnSpec =>
  ({
    name: "plate",
    type: "short_string",
    pattern,
    // 4,800 rows after 200 NA: 3,000 once, 700 twice, 100 four times = 3,000 + 1,400 + 400 = 4,800 rows
    length_groups: { "7": 3500, "6": 250, "5": 50 },
    repeat_structure: { "1": 3000, "2": 700, "4": 100 },
    na: { tokens: ["", "NA"], count: 200, by_token: { "": 120, NA: 80 } },
    ...over,
  }) as ColumnSpec;

const spec = (cols: ColumnSpec[]): SpecFile => ({
  spec_version: SPEC_VERSION,
  source: { format: "csv", file_name: "t.csv", encoding: "utf-8", delimiter: ",", quote: '"', header: true },
  n_rows: N,
  seed: 9,
  columns: cols,
});

const values = (c: ColumnSpec, seed = 9) => {
  const plan = planTable({ ...spec([c]), seed });
  return Array.from({ length: N }, (_, r) => rowValues(plan, r)[0]);
};
const repeatOf = (list: string[]) => {
  const per = new Map<string, number>();
  for (const v of list) per.set(v, (per.get(v) ?? 0) + 1);
  const structure: Record<string, number> = {};
  for (const n of per.values()) structure[n] = (structure[n] ?? 0) + 1;
  return { structure, per };
};

describe("short strings", () => {
  const all = values(plate());
  const real = all.filter((v) => v !== "" && v !== "NA");

  it("the spec used here is valid", () => {
    const r = validateSpec(spec([plate()]));
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    expect(r.ok).toBe(true);
  });

  it("every value fits the pattern at its length", () => {
    const full = /^[A-Z]{2}-\d{4}$/;
    const six = /^[A-Z]{2}-\d{3}$/;
    const five = /^[A-Z]{2}-\d{2}$/;
    for (const v of real) expect(v.length === 7 ? full.test(v) : v.length === 6 ? six.test(v) : five.test(v), v).toBe(true);
  });

  it("each length has exactly its recorded number of distinct values", () => {
    const { per } = repeatOf(real);
    const byLength: Record<string, number> = {};
    for (const v of per.keys()) byLength[v.length] = (byLength[v.length] ?? 0) + 1;
    expect(byLength).toEqual({ "7": 3500, "6": 250, "5": 50 });
  });

  it("has exactly the repeat structure and the NA counts", () => {
    expect(repeatOf(real).structure).toEqual({ "1": 3000, "2": 700, "4": 100 });
    expect(all.filter((v) => v === "").length).toBe(120);
    expect(all.filter((v) => v === "NA").length).toBe(80);
  });

  it("does not tie length to how often a value repeats", () => {
    const { per } = repeatOf(real);
    const short = [...per].filter(([v]) => v.length < 7);
    const repeated = short.filter(([, n]) => n > 1).length / short.length;
    // 28% of all values repeat (800 of 3,800 groups), so short values should repeat about as often.
    expect(repeated).toBeGreaterThan(0.1);
    expect(repeated).toBeLessThan(0.45);
  });

  it("is deterministic, chunk independent and seed dependent", () => {
    const s = spec([plate()]);
    const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
    const ref = renderAll(planTable(s), 5000);
    for (const chunk of [1, 61, 5000]) expect(same(renderAll(planTable(s), chunk), ref)).toBe(true);
    expect(same(renderAll(planTable({ ...s, seed: 10 }), 5000), ref)).toBe(false);
  });

  it("the check table has distinct count, repeat structure and the exact shortest and longest length", () => {
    const plan = planTable(spec([plate()]));
    const acc = new CheckAccumulator(plan);
    for (let r = 0; r < plan.nRows; r++) acc.observeRow(rowValues(plan, r));
    const checks = acc.finish();
    expect(checks.map((c) => c.metric).sort()).toEqual(["distinct_count", "length_max", "length_min", "na_count", "repeat_structure"]);
    expect(checks.find((c) => c.metric === "length_min")).toMatchObject({ target: "5", achieved: "5" });
    expect(checks.find((c) => c.metric === "length_max")).toMatchObject({ target: "7", achieved: "7" });
    expect(checks.filter((c) => !c.pass)).toEqual([]);
  });

  it("works with a punctuation-free pattern of mixed classes", () => {
    const code = plate({ name: "code", pattern: ["alnum", "alnum", "alnum", "alnum", "alnum"], length_groups: { "5": 3900 }, repeat_structure: { "1": 3000, "2": 900 } });
    expect(repeatOf(values(code).filter((v) => v !== "" && v !== "NA")).structure).toEqual({ "1": 3000, "2": 900 });
  });
});

describe("a pattern too narrow", () => {
  it("is refused by the generator, with the shortfall", () => {
    expect(() => makeShortStringGenerator({ pattern: ["digit"], length_groups: { "1": 30 } }, 1)).toThrow(ShortStringError);
    try {
      makeShortStringGenerator({ pattern: ["digit"], length_groups: { "1": 30 } }, 1);
    } catch (e) {
      expect((e as ShortStringError).allowed).toBe(10n);
      expect((e as ShortStringError).needed).toBe(30);
    }
  });

  it("is refused for a column, as a generation error that names the column", () => {
    const narrow = plate({ name: "tight", pattern: ["digit"], length_groups: { "1": 4800 }, repeat_structure: { "1": 4800 } });
    expect(() => planTable(spec([narrow]))).toThrow(GenerationError);
    expect(() => planTable(spec([narrow]))).toThrow(/tight/);
  });
});

describe("makeShortStringGenerator", () => {
  it("makes the same value for the same group, and different values for different groups of a length", () => {
    const g = makeShortStringGenerator({ pattern, length_groups: { "7": 500 } }, 4);
    expect(g(7)).toBe(g(7));
    expect(new Set(Array.from({ length: 500 }, (_, i) => g(i))).size).toBe(500);
  });

  it("copes with a space too big for numbers (a long alnum pattern)", () => {
    const longPattern: MaskToken[] = Array.from({ length: 20 }, () => "alnum" as const);
    const g = makeShortStringGenerator({ pattern: longPattern, length_groups: { "20": 1000 } }, 2);
    const v = new Set(Array.from({ length: 1000 }, (_, i) => g(i)));
    expect(v.size).toBe(1000);
    for (const s of v) expect(s).toMatch(/^[0-9A-Za-z]{20}$/);
  });
});
