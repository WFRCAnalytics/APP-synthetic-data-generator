import { describe, expect, it } from "vitest";
import { createRng, mix32 } from "../../src/lib/rng/sfc32";
import { subSeed } from "../../src/lib/rng/subseed";

function stats(values: number[]) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) };
}

describe("sfc32 generator", () => {
  it("is deterministic for a given seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it("gives different streams for different seeds", () => {
    const a = createRng(1);
    const b = createRng(2);
    const first = Array.from({ length: 10 }, () => a());
    const second = Array.from({ length: 10 }, () => b());
    expect(first).not.toEqual(second);
  });

  it("stays inside [0, 1) and looks uniform", () => {
    const rng = createRng(7);
    const values = Array.from({ length: 100_000 }, () => rng());
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const { mean, sd } = stats(values);
    expect(mean).toBeCloseTo(0.5, 2);
    expect(sd).toBeCloseTo(Math.sqrt(1 / 12), 2);
  });

  it("separates nearby seeds right away", () => {
    // Consecutive seeds must not produce visibly similar first draws.
    const firsts = Array.from({ length: 200 }, (_, s) => createRng(s)());
    expect(new Set(firsts).size).toBe(200);
  });

  it("mix32 spreads small inputs over the whole 32-bit range", () => {
    const out = Array.from({ length: 1000 }, (_, i) => mix32(i));
    expect(new Set(out).size).toBe(1000);
    expect(Math.max(...out)).toBeGreaterThan(2 ** 31);
  });
});

describe("column sub-seeds", () => {
  it("depends only on the global seed and the column name", () => {
    expect(subSeed(42, "mode")).toBe(subSeed(42, "mode"));
  });

  it("differs by column name and by global seed", () => {
    const names = ["mode", "purpose", "income", "hh_id", "depart_time", "trip_dist_mi"];
    const seeds = names.map((n) => subSeed(42, n));
    expect(new Set(seeds).size).toBe(names.length);
    expect(subSeed(42, "mode")).not.toBe(subSeed(43, "mode"));
  });

  it("is unaffected by other columns (no shared state)", () => {
    const before = subSeed(42, "mode");
    subSeed(42, "other");
    subSeed(99, "mode");
    expect(subSeed(42, "mode")).toBe(before);
  });

  it("handles non-ASCII names", () => {
    expect(subSeed(1, "東京")).not.toBe(subSeed(1, "Zürich"));
  });

  it("returns an unsigned 32-bit integer", () => {
    const s = subSeed(2 ** 32 - 1, "x");
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(2 ** 32);
  });
});
