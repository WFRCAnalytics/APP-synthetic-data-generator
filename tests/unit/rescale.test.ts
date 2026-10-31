import { describe, expect, it } from "vitest";
import { createColumnGen } from "../../src/lib/generate/column";
import { renderAll } from "../../src/lib/generate/render";
import { planTable } from "../../src/lib/generate/table";
import { SPEC_VERSION, type ColumnSpec, type SpecFile } from "../../src/lib/spec/types";

const N = 20_000;

function stats(values: number[]) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return { mean, sd };
}
const minOf = (xs: number[]) => xs.reduce((a, b) => Math.min(a, b), Infinity);
const maxOf = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), -Infinity);

const base: ColumnSpec = {
  name: "dist",
  type: "float",
  mode: "match_mean_sd",
  min: 0.05,
  max: 87.4,
  mean: 6.83,
  sd: 8.91,
  decimals: 2,
};
const column = (c: ColumnSpec, seed = 42, n = N) => {
  const gen = createColumnGen(c, { seed, nRows: n });
  return Array.from({ length: n }, (_, r) => gen.valueAt(r));
};
const spec = (columns: ColumnSpec[], n = 2000): SpecFile => ({
  spec_version: SPEC_VERSION,
  source: { format: "csv", file_name: "t.csv", encoding: "utf-8", delimiter: ",", quote: '"', header: true },
  n_rows: n,
  seed: 7,
  columns,
});

describe("rescaling restores the exact mean and sd (FR-027)", () => {
  it("lands much closer to the targets than the plain fit", () => {
    const plain = stats(column(base).map(Number));
    const scaled = stats(column({ ...base, rescale: true }).map(Number));
    expect(Math.abs(scaled.mean - 6.83)).toBeLessThan(0.02);
    expect(Math.abs(scaled.sd - 8.91)).toBeLessThan(0.05);
    expect(Math.abs(scaled.sd - 8.91)).toBeLessThanOrEqual(Math.abs(plain.sd - 8.91) + 1e-9);
  });

  it("keeps the exact min and max (the two pinned rows are never moved)", () => {
    const values = column({ ...base, rescale: true }).map(Number);
    expect(minOf(values)).toBe(0.05);
    expect(maxOf(values)).toBe(87.4);
    expect(values.filter((v) => v === 0.05).length).toBeGreaterThanOrEqual(1);
    expect(values.filter((v) => v === 87.4).length).toBe(1);
  });

  it("never leaves the real range", () => {
    const values = column({ ...base, rescale: true }).map(Number);
    expect(minOf(values)).toBeGreaterThanOrEqual(0.05);
    expect(maxOf(values)).toBeLessThanOrEqual(87.4);
  });

  it("works for integers and keeps them whole", () => {
    const c: ColumnSpec = { name: "n", type: "integer", mode: "match_mean_sd", min: 0, max: 600, mean: 120, sd: 90, rescale: true };
    const values = column(c);
    expect(values.every((v) => /^\d+$/.test(v))).toBe(true);
    const s = stats(values.map(Number));
    expect(Math.abs(s.mean - 120)).toBeLessThan(1);
    expect(Math.abs(s.sd - 90)).toBeLessThan(2);
  });

  it("works for dates and times, which are numbers while they are generated", () => {
    const c: ColumnSpec = { name: "t", type: "time", mode: "match_mean_sd", min: 0, max: 86340, mean: 43000, sd: 20000, format: "%H:%M", granularity: "minute", rescale: true };
    const seconds = column(c).map((v) => Number(v.slice(0, 2)) * 3600 + Number(v.slice(3, 5)) * 60);
    const s = stats(seconds);
    expect(Math.abs(s.mean - 43000) / 43000).toBeLessThan(0.01);
    expect(Math.abs(s.sd - 20000) / 20000).toBeLessThan(0.02);
    expect(minOf(seconds)).toBe(0);
    expect(maxOf(seconds)).toBe(86340);
  });

  it("is off by default and does nothing for the other modes", () => {
    expect(column(base)).toEqual(column({ ...base, rescale: false }));
    const uniform: ColumnSpec = { ...base, mode: "uniform", rescale: true };
    expect(column(uniform)).toEqual(column({ ...uniform, rescale: false }));
  });

  it("gives the same values for the same seed, and different ones for another", () => {
    const c: ColumnSpec = { ...base, rescale: true };
    expect(column(c, 1, 2000)).toEqual(column(c, 1, 2000));
    expect(column(c, 1, 2000)).not.toEqual(column(c, 2, 2000));
  });

  it("does not depend on the chunk size", () => {
    const s = spec([{ ...base, rescale: true }]);
    expect(renderAll(planTable(s), 13)).toEqual(renderAll(planTable(s), 100000));
  });

  it("does not change any other column", () => {
    const other: ColumnSpec = { name: "other", type: "integer", mode: "uniform", min: 0, max: 100 };
    const plain = renderAll(planTable(spec([base, other])));
    const scaled = renderAll(planTable(spec([{ ...base, rescale: true }, other])));
    const col = (bytes: Uint8Array, index: number) =>
      new TextDecoder().decode(bytes).split("\n").slice(1).map((line) => line.split(",")[index]);
    expect(col(scaled, 1)).toEqual(col(plain, 1));
    expect(col(scaled, 0)).not.toEqual(col(plain, 0));
  });

  it("copes with a constant column, a zero sd and a single value", () => {
    expect(new Set(column({ ...base, min: 3, max: 3, mean: 3, sd: 0, rescale: true }, 1, 100))).toEqual(new Set(["3.00"]));
    expect(() => column({ ...base, sd: 0, rescale: true }, 1, 100)).not.toThrow();
    expect(() => column({ ...base, rescale: true }, 1, 1)).not.toThrow();
  });

  it("leaves NA and sentinel rows untouched", () => {
    const c: ColumnSpec = { ...base, rescale: true, na: { tokens: [""], count: 300 }, sentinels: { "-9": 200 } };
    const values = column(c);
    expect(values.filter((v) => v === "").length).toBe(300);
    expect(values.filter((v) => v === "-9").length).toBe(200);
  });
});
