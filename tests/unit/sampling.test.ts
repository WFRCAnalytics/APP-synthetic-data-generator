import { describe, expect, it } from "vitest";
import { createRng } from "../../src/lib/rng/sfc32";
import {
  betaValue,
  fitBeta,
  interpolateQuantile,
  sampleBeta,
  sampleGamma,
  sampleNormal,
  uniformValue,
} from "../../src/lib/sampling";

const minOf = (values: number[]) => values.reduce((a, b) => Math.min(a, b), Infinity);
const maxOf = (values: number[]) => values.reduce((a, b) => Math.max(a, b), -Infinity);

function moments(values: number[]) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, sd: Math.sqrt(variance) };
}

describe("uniform", () => {
  it("maps [0, 1) onto [min, max)", () => {
    expect(uniformValue(0, 10, 20)).toBe(10);
    expect(uniformValue(0.5, 10, 20)).toBe(15);
    expect(uniformValue(0.999999, 10, 20)).toBeLessThan(20);
  });
});

describe("quantile interpolation", () => {
  const q = Array.from({ length: 101 }, (_, i) => i * 2); // 0, 2, ..., 200

  it("returns the stored values at the nodes", () => {
    expect(interpolateQuantile(q, 0)).toBe(0);
    expect(interpolateQuantile(q, 0.5)).toBe(100);
    expect(interpolateQuantile(q, 0.01)).toBeCloseTo(2, 10);
  });

  it("interpolates linearly between nodes", () => {
    expect(interpolateQuantile(q, 0.005)).toBeCloseTo(1, 10);
    expect(interpolateQuantile(q, 0.255)).toBeCloseTo(51, 10);
  });

  it("never leaves the stored range", () => {
    expect(interpolateQuantile(q, 0.9999999)).toBeLessThanOrEqual(200);
    expect(interpolateQuantile(q, 0)).toBeGreaterThanOrEqual(0);
  });

  it("reproduces a skewed distribution's shape", () => {
    // Quantiles of a skewed column: most values low, a long tail.
    const skewed = Array.from({ length: 101 }, (_, i) => Math.pow(i / 100, 3) * 1000);
    const rng = createRng(3);
    const draws = Array.from({ length: 50000 }, () => interpolateQuantile(skewed, rng()));
    const median = [...draws].sort((a, b) => a - b)[25000];
    expect(median).toBeGreaterThan(110);
    expect(median).toBeLessThan(140); // true median is 125
  });
});

describe("normal and gamma", () => {
  it("draws normals with mean 0 and sd 1", () => {
    const rng = createRng(11);
    const { mean, sd } = moments(Array.from({ length: 100000 }, () => sampleNormal(rng)));
    expect(mean).toBeCloseTo(0, 1);
    expect(sd).toBeCloseTo(1, 1);
  });

  it.each([0.5, 1, 2, 5.5])("draws gamma(%f) with mean and variance equal to the shape", (shape) => {
    const rng = createRng(100 + shape * 10);
    const { mean, sd } = moments(Array.from({ length: 100000 }, () => sampleGamma(rng, shape)));
    expect(mean / shape).toBeGreaterThan(0.97);
    expect(mean / shape).toBeLessThan(1.03);
    expect((sd * sd) / shape).toBeGreaterThan(0.93);
    expect((sd * sd) / shape).toBeLessThan(1.07);
  });

  it("rejects a non-positive shape", () => {
    expect(() => sampleGamma(createRng(1), 0)).toThrow(RangeError);
    expect(() => sampleGamma(createRng(1), -1)).toThrow(RangeError);
  });
});

describe("beta", () => {
  it("draws values strictly inside (0, 1) with the right moments", () => {
    const rng = createRng(5);
    const a = 2;
    const b = 5;
    const draws = Array.from({ length: 100000 }, () => sampleBeta(rng, a, b));
    expect(minOf(draws)).toBeGreaterThan(0);
    expect(maxOf(draws)).toBeLessThan(1);
    const { mean, sd } = moments(draws);
    expect(mean).toBeCloseTo(a / (a + b), 2);
    expect(sd).toBeCloseTo(Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1))), 2);
  });
});

describe("beta fit", () => {
  it("recovers the mean and sd it was fitted to", () => {
    const min = 0;
    const max = 87.4;
    const mean = 6.83;
    const sd = 8.91;
    const fit = fitBeta(mean, sd, min, max);
    expect(fit).not.toBeNull();
    const rng = createRng(21);
    const draws = Array.from({ length: 150000 }, () => betaValue(rng, fit!, min, max));
    const got = moments(draws);
    expect(got.mean).toBeCloseTo(mean, 0);
    expect(got.sd / sd).toBeGreaterThan(0.95);
    expect(got.sd / sd).toBeLessThan(1.05);
    expect(minOf(draws)).toBeGreaterThanOrEqual(min);
    expect(maxOf(draws)).toBeLessThanOrEqual(max);
  });

  it("fits a symmetric case exactly", () => {
    const fit = fitBeta(0.5, Math.sqrt(1 / 36), 0, 1)!; // beta(2, 2)
    expect(fit.alpha).toBeCloseTo(fit.beta, 10);
    expect(fit.alpha).toBeGreaterThan(0);
  });

  it.each([
    ["sd of zero", 5, 0, 0, 10],
    ["a mean on the lower bound", 0, 1, 0, 10],
    ["a mean on the upper bound", 10, 1, 0, 10],
    ["an sd too large for the range", 5, 6, 0, 10],
    ["a zero-width range", 5, 1, 5, 5],
  ])("returns null for %s", (_label, mean, sd, min, max) => {
    expect(fitBeta(mean, sd, min, max)).toBeNull();
  });
});
