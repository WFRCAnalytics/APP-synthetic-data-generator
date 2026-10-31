import { describe, expect, it } from "vitest";
import { drawUniform, rowRng } from "../../src/lib/rng/counter";

describe("counter-based draws", () => {
  it("depends only on (key, row, stream), not on call order", () => {
    const forward = Array.from({ length: 50 }, (_, r) => drawUniform(7, r));
    const backward = Array.from({ length: 50 }, (_, r) => drawUniform(7, 49 - r)).reverse();
    expect(backward).toEqual(forward);
  });

  it("returns values in [0, 1)", () => {
    for (let r = 0; r < 10000; r++) {
      const u = drawUniform(3, r);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });

  it("looks uniform across rows", () => {
    const n = 100000;
    let sum = 0;
    let sumSq = 0;
    for (let r = 0; r < n; r++) {
      const u = drawUniform(11, r);
      sum += u;
      sumSq += u * u;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sumSq / n - mean * mean);
    expect(mean).toBeCloseTo(0.5, 2);
    expect(sd).toBeCloseTo(Math.sqrt(1 / 12), 2);
  });

  it("differs by key and by stream", () => {
    expect(drawUniform(1, 5)).not.toBe(drawUniform(2, 5));
    expect(drawUniform(1, 5, 0)).not.toBe(drawUniform(1, 5, 1));
  });

  it("rarely repeats a value across many rows", () => {
    const seen = new Set<number>();
    for (let r = 0; r < 50000; r++) seen.add(drawUniform(5, r));
    expect(seen.size).toBeGreaterThan(49990);
  });

  it("rowRng gives the same sequence for the same row, different for others", () => {
    const a = rowRng(9, 100);
    const b = rowRng(9, 100);
    const c = rowRng(9, 101);
    const sa = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(sa);
    expect([c(), c(), c()]).not.toEqual(sa);
  });
});
