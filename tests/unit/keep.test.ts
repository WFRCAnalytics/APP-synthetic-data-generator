// What a fake column keeps (specs/032): counts, missing values and range are coarsened as chosen, always adding up, never writing the real figure.
import { describe, expect, it } from "vitest";
import { applyKeep, largestRemainder, presetChoices, roundOutward, roundRange, roundingUnit, shapeCounts } from "../../src/lib/keep/keep";
import { planTable, rowValues } from "../../src/lib/generate/table";
import { SPEC_VERSION, type CategoricalColumn, type ColumnSpec, type SpecFile } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe("largestRemainder", () => {
  it("adds up to the total", () => {
    expect(largestRemainder([1, 1, 1], 10).reduce((a, b) => a + b, 0)).toBe(10);
    expect(largestRemainder([5, 3], 8)).toEqual([5, 3]);
    expect(largestRemainder([0, 0], 5)).toEqual([3, 2]);
  });
});

describe("rounding", () => {
  it("steps by a share of the rows, never less than 5", () => {
    expect(roundingUnit(100)).toBe(5);
    expect(roundingUnit(100_000)).toBe(1000);
  });
  it("widens a number outward to two digits", () => {
    expect(roundOutward(12_345, "down")).toBe(12_000);
    expect(roundOutward(987_654, "up")).toBe(990_000);
    expect(roundOutward(18, "down")).toBe(18);
    expect(roundOutward(92, "up")).toBe(92);
    expect(roundOutward(-12_345, "down")).toBe(-13_000);
  });
  it("widens dates to whole months, date-times to days, times to hours", () => {
    const day = (iso: string) => Date.parse(iso) / 86_400_000;
    expect(roundRange("date", day("2025-03-14"), day("2025-07-09"))).toEqual({ min: day("2025-03-01"), max: day("2025-07-31") });
    expect(roundRange("datetime", 86_400 * 10 + 5000, 86_400 * 12 + 30)).toEqual({ min: 86_400 * 10, max: 86_400 * 13 });
    expect(roundRange("time", 3700, 40_000)).toEqual({ min: 3600, max: 43_200 });
    // Late in the day the range stops at 23:59, which every granularity can write, unless the real maximum is later still.
    expect(roundRange("time", 3700, 86_000)).toEqual({ min: 3600, max: 86_340 });
    expect(roundRange("time", 3700, 86_399)).toEqual({ min: 3600, max: 86_399 });
  });
});

describe("shapeCounts", () => {
  const counts = { a: 4000, b: 2500, c: 3300, d: 200 };
  it("keeps exact counts when they already add up", () => {
    expect(shapeCounts(counts, 10_000, "exact", 10_000)).toEqual(counts);
  });
  it("rounds to the step, adds up, and keeps every label", () => {
    const out = shapeCounts(counts, 10_000, "rounded", 10_000);
    expect(sum(out)).toBe(10_000);
    expect(Object.keys(out).sort()).toEqual(["a", "b", "c", "d"]);
    for (const l of ["a", "b", "c"]) expect(Math.abs(out[l] - counts[l as keyof typeof counts])).toBeLessThanOrEqual(roundingUnit(10_000));
  });
  it("gives every label the same share", () => {
    const out = shapeCounts(counts, 10_000, "equal", 10_000);
    expect(Object.values(out)).toEqual([2500, 2500, 2500, 2500]);
  });
  it("rescales to fewer rows when values are missing", () => {
    expect(sum(shapeCounts(counts, 9000, "exact", 10_000))).toBe(9000);
  });
});

const cat = (counts: Record<string, number>, na?: number): CategoricalColumn => ({ name: "zone", type: "categorical", counts, ...(na ? { na: { tokens: [""], count: na } } : {}) });
const number = (min: number, max: number, na?: number): ColumnSpec => ({ name: "income", type: "integer", mode: "match_mean_sd", min, max, mean: (min + max) / 2, sd: (max - min) / 5, decimals: 0, quantiles: Array.from({ length: 101 }, (_, i) => min + ((max - min) * i) / 100), ...(na ? { na: { tokens: [""], count: na } } : {}) });

describe("applyKeep", () => {
  it("leaves a column alone when everything is exact", () => {
    const c = cat({ a: 600, b: 400 }, 0);
    expect(applyKeep(c, { counts: "exact", missing: "exact" }, 1000)).toMatchObject({ counts: { a: 600, b: 400 } });
  });

  it("rounds the missing count and the label counts together so they add up to the rows", () => {
    const out = applyKeep(cat({ a: 5_123, b: 3_811, c: 666 }, 400), { counts: "rounded", missing: "rounded" }, 10_000) as CategoricalColumn;
    expect(sum(out.counts) + (out.na?.count ?? 0)).toBe(10_000);
    expect(out.na?.count).toBe(400);
    expect(out.keep).toEqual({ counts: "rounded", missing: "rounded" });
  });

  it("leaves out missing values when asked, and the labels fill every row", () => {
    const out = applyKeep(cat({ a: 600, b: 300 }, 100), { counts: "exact", missing: "none" }, 1000) as CategoricalColumn;
    expect(out.na).toBeUndefined();
    expect(sum(out.counts)).toBe(1000);
  });

  it("drops a missing count that rounds to nothing", () => {
    expect(applyKeep(cat({ a: 990 }, 2), { missing: "rounded" }, 1000).na).toBeUndefined();
  });

  it("widens a number's range outward and keeps the percentiles inside it", () => {
    const out = applyKeep(number(12_345, 987_654), { range: "rounded" }, 1000) as ColumnSpec & { min: number; max: number; quantiles: number[] };
    expect([out.min, out.max]).toEqual([12_000, 990_000]);
    expect(out.quantiles[0]).toBe(12_000);
    expect(out.quantiles[100]).toBe(990_000);
    expect(out.keep).toEqual({ range: "rounded" });
  });

  it("does not touch ID, personal or text columns", () => {
    const id = { name: "id", type: "survey_id", mask: ["digit"], repeat_structure: { "1": 10 } } as ColumnSpec;
    expect(applyKeep(id, { counts: "equal", missing: "none", range: "rounded" }, 10)).toBe(id);
  });
});

describe("a spec built with these choices", () => {
  const spec = (columns: ColumnSpec[], rows: number): SpecFile => ({ spec_version: SPEC_VERSION, source: { format: "csv", file_name: "t.csv", encoding: "utf-8", delimiter: ",", quote: '"', quote_style: "minimal", line_ending: "lf", trailing_newline: true, header: true }, n_rows: rows, seed: 1, columns });
  const rows = 2000;
  const real = [cat({ a: 1_103, b: 611, c: 237 }, 49), number(12_345, 987_654, 49)];
  const kept = real.map((c) => applyKeep(c, presetChoices("balanced").keep, rows));

  it("is valid and generates, with every count as the spec says", () => {
    const s = spec(kept, rows);
    const r = validateSpec(JSON.parse(JSON.stringify(s)));
    expect(r.ok ? [] : r.problems).toEqual([]);
    const plan = planTable(s, 1);
    const out = Array.from({ length: rows }, (_, i) => rowValues(plan, i));
    const labels = new Map<string, number>();
    for (const [z] of out) labels.set(z, (labels.get(z) ?? 0) + 1);
    const want = kept[0] as CategoricalColumn;
    expect(labels.get("")).toBe(want.na?.count);
    for (const [l, n] of Object.entries(want.counts)) expect(labels.get(l)).toBe(n);
  });

  it("does not write the real counts or the real range", () => {
    const text = JSON.stringify(kept);
    expect(text).not.toContain("12345");
    expect(text).not.toContain("987654");
    expect(text).not.toContain("1103");
  });
});

describe("a saved spec is not coarsened a second time", () => {
  it("builds the same columns when its profiles are built again", async () => {
    const { profilesFromSpec } = await import("../../src/lib/spec/toProfiles");
    const { buildSpec } = await import("../../src/lib/spec/build");
    const rows = 5000;
    const base = applyKeep(cat({ a: 2_613, b: 1_377, c: 641, d: 81 }, 288), { counts: "rounded", missing: "rounded" }, rows);
    const spec: SpecFile = { spec_version: SPEC_VERSION, source: { format: "csv", file_name: "t.csv", encoding: "utf-8", delimiter: ",", quote: '"', quote_style: "minimal", line_ending: "lf", trailing_newline: true, header: true }, n_rows: rows, seed: 1, columns: [base] };
    const again = buildSpec({ fileName: "t.csv", settings: { encoding: "utf-8", bom: false, delimiter: ",", quote: '"', quoteStyle: "minimal", lineEnding: "lf", header: true, headerQuoted: false, trailingNewline: true }, rowCount: rows, seed: 1, keepOriginalName: false, threshold: 20, profiles: profilesFromSpec(spec.columns) });
    const pick = (c: unknown) => { const { counts, na, keep } = c as CategoricalColumn; return { counts, na, keep }; };
    expect(pick(again.columns[0])).toEqual(pick(spec.columns[0]));
  });
});
