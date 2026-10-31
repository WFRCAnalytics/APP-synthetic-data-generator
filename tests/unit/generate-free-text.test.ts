// Generating free text columns (specs/002 FR-006, SC-004, research R7): exact shortest and longest
// length, a spread that follows the quantiles, no real word, line breaks only when the real column had
// them, and output that depends on nothing but the seed.

import { describe, expect, it } from "vitest";
import { CheckAccumulator } from "../../src/lib/generate/checks";
import { renderAll } from "../../src/lib/generate/render";
import { planTable, rowValues } from "../../src/lib/generate/table";
import { loremText } from "../../src/lib/textgen/lorem";
import { SPEC_VERSION, type ColumnSpec, type SpecFile } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";

const N = 4000;
// A skewed length distribution: many short answers, a long tail.
const quantiles = Array.from({ length: 101 }, (_, i) => Math.round(3 + (i / 100) ** 3 * 397));

const note = (over: Record<string, unknown> = {}): ColumnSpec =>
  ({ name: "note", type: "free_text", mode: "match_shape", min: 3, max: 400, mean: 60, sd: 70, decimals: 0, quantiles, line_breaks: false, na: { tokens: [""], count: 200 }, ...over }) as ColumnSpec;

const spec = (cols: ColumnSpec[], over: Partial<SpecFile> = {}): SpecFile => ({
  spec_version: SPEC_VERSION,
  source: { format: "csv", file_name: "t.csv", encoding: "utf-8", delimiter: ",", quote: '"', header: true },
  n_rows: N,
  seed: 5,
  columns: cols,
  ...over,
});

const values = (c: ColumnSpec, seed = 5) => {
  const plan = planTable(spec([c]), seed);
  return Array.from({ length: N }, (_, r) => rowValues(plan, r)[0]);
};
const written = (c: ColumnSpec) => values(c).filter((v) => v !== "");

describe("free text", () => {
  it("the spec used here is valid", () => {
    const r = validateSpec(spec([note()]));
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    expect(r.ok).toBe(true);
  });

  it("hits the exact shortest and longest length, once each", () => {
    const lengths = written(note()).map((v) => v.length);
    expect(Math.min(...lengths)).toBe(3);
    expect(Math.max(...lengths)).toBe(400);
    expect(lengths.filter((l) => l === 3).length).toBeGreaterThanOrEqual(1);
    expect(lengths.every((l) => l >= 3 && l <= 400)).toBe(true);
  });

  it("follows the real spread of lengths", () => {
    const lengths = written(note()).map((v) => v.length).sort((a, b) => a - b);
    const median = lengths[Math.floor(lengths.length / 2)];
    const want = quantiles[50];
    expect(Math.abs(median - want)).toBeLessThanOrEqual(Math.max(3, want * 0.15));
    const p90 = lengths[Math.floor(lengths.length * 0.9)];
    expect(Math.abs(p90 - quantiles[90])).toBeLessThanOrEqual(quantiles[90] * 0.15);
  });

  it("keeps the exact NA count", () => {
    expect(values(note()).filter((v) => v === "").length).toBe(200);
  });

  it("writes filler text, never ends in a space, and has no line break unless the real column had them", () => {
    for (const v of written(note()).slice(0, 500)) {
      expect(v).toMatch(/^[A-Za-z., ]+$/);
      expect(v.endsWith(" ")).toBe(false);
    }
    expect(written(note()).some((v) => v.includes("\n"))).toBe(false);
  });

  it("puts a line break in some longer values when the real column had them", () => {
    const withBreaks = written(note({ line_breaks: true }));
    const n = withBreaks.filter((v) => v.includes("\n")).length;
    expect(n).toBeGreaterThan(20);
    expect(n).toBeLessThan(withBreaks.length * 0.2);
    // A line break counts as one character, so the exact lengths still hold.
    expect(Math.max(...withBreaks.map((v) => v.length))).toBe(400);
  });

  it("is deterministic, chunk independent and seed dependent", () => {
    const s = spec([note()]);
    const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
    const ref = renderAll(planTable(s), 5000);
    for (const chunk of [1, 77, 4000]) expect(same(renderAll(planTable(s), chunk), ref)).toBe(true);
    expect(same(renderAll(planTable(s, 6)), ref)).toBe(false);
  });

  it("the check table has the exact length minimum and maximum", () => {
    const plan = planTable(spec([note()]));
    const acc = new CheckAccumulator(plan);
    for (let r = 0; r < plan.nRows; r++) acc.observeRow(rowValues(plan, r));
    const checks = acc.finish();
    expect(checks.find((c) => c.metric === "min")).toMatchObject({ target: "3", achieved: "3", pass: true });
    expect(checks.find((c) => c.metric === "max")).toMatchObject({ target: "400", achieved: "400", pass: true });
    expect(checks.filter((c) => !c.pass)).toEqual([]);
  });

  it("handles the longest allowed text", () => {
    const long = note({ min: 10, max: 100000, mode: "uniform", mean: undefined, sd: undefined, quantiles: undefined, na: undefined });
    const plan = planTable(spec([long], { n_rows: 5 }), 1);
    const lengths = Array.from({ length: 5 }, (_, r) => rowValues(plan, r)[0].length);
    expect(Math.max(...lengths)).toBe(100000);
    expect(Math.min(...lengths)).toBe(10);
  });
});

describe("loremText", () => {
  it("makes exactly the length asked for, from one character up", () => {
    for (const n of [1, 2, 5, 17, 100, 999]) expect(loremText(n, 3, 9).length).toBe(n);
    expect(loremText(0, 3, 9)).toBe("");
  });

  it("depends only on (key, row, length)", () => {
    expect(loremText(80, 1, 5)).toBe(loremText(80, 1, 5));
    expect(loremText(80, 1, 5)).not.toBe(loremText(80, 1, 6));
    expect(loremText(80, 1, 5)).not.toBe(loremText(80, 2, 5));
  });
});
