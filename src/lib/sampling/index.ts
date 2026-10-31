// Hand-written samplers for the three numeric modes (SPEC.md "Numeric modes"): uniform, a beta
// distribution fitted to mean and sd (beta draws come from two gamma draws), and interpolation of
// stored percentiles. All take a uniform draw or a generator, so callers decide where randomness
// comes from (counter-based per row, for chunk-independent output).

import type { Rng } from "../rng/sfc32";

/** Uniform between min and max for u in [0, 1). */
export function uniformValue(u: number, min: number, max: number): number {
  return min + u * (max - min);
}

/**
 * Interpolates between stored percentiles. `quantiles` has 101 values (1% steps); u in [0, 1)
 * picks a position along them. Keeps skew, peaks and the median of the real column.
 */
export function interpolateQuantile(quantiles: readonly number[], u: number): number {
  const last = quantiles.length - 1;
  const pos = u * last;
  const lo = Math.min(Math.floor(pos), last);
  const hi = Math.min(lo + 1, last);
  const frac = pos - lo;
  return quantiles[lo] + (quantiles[hi] - quantiles[lo]) * frac;
}

/** A standard normal draw (Box-Muller). */
export function sampleNormal(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** A gamma(shape, 1) draw by the Marsaglia-Tsang method; shapes below 1 are boosted. */
export function sampleGamma(rng: Rng, shape: number): number {
  if (!(shape > 0)) throw new RangeError("gamma shape must be positive");
  if (shape < 1) {
    // Gamma(a) = Gamma(a + 1) * U^(1/a)
    let u = 0;
    while (u === 0) u = rng();
    return sampleGamma(rng, shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = sampleNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** A beta(alpha, beta) draw in (0, 1), from two gamma draws. */
export function sampleBeta(rng: Rng, alpha: number, beta: number): number {
  const x = sampleGamma(rng, alpha);
  const y = sampleGamma(rng, beta);
  return x / (x + y);
}

export interface BetaFit {
  alpha: number;
  beta: number;
}

/**
 * Fits a beta distribution scaled to [min, max] to a target mean and sd (SPEC.md formulas).
 * Returns null when no beta can match (the mean sits on a bound, sd is zero, or the sd is larger
 * than any beta on that range allows), so the caller can fall back to uniform and flag the column.
 */
export function fitBeta(mean: number, sd: number, min: number, max: number): BetaFit | null {
  const range = max - min;
  if (!(range > 0) || !(sd > 0)) return null;
  const m = (mean - min) / range;
  const v = (sd * sd) / (range * range);
  if (!(m > 0 && m < 1)) return null;
  const k = (m * (1 - m)) / v - 1;
  if (!(k > 0) || !Number.isFinite(k)) return null;
  return { alpha: m * k, beta: (1 - m) * k };
}

/** A value on [min, max] from a fitted beta. */
export function betaValue(rng: Rng, fit: BetaFit, min: number, max: number): number {
  return min + sampleBeta(rng, fit.alpha, fit.beta) * (max - min);
}
