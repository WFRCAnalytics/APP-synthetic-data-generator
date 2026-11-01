// The 101 percentile values (1% steps) a numeric column of the spec carries, computed from what a person
// says about the column. No dependency: the normal curve is evaluated with standard approximations.

/** The standard normal distribution function (Abramowitz and Stegun 26.2.17, error under 1e-7). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** Inverse of the standard normal distribution function (Acklam's rational approximation, error under 1.2e-9). */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** 101 values from min to max in equal steps. */
export const evenQuantiles = (min: number, max: number): number[] => Array.from({ length: 101 }, (_, i) => min + ((max - min) * i) / 100);

/**
 * 101 percentile values of a bell curve centred on `typical` with the given spread, cut off at min and
 * max (so no value is outside the range). The first value is min and the last is max.
 */
export function bellQuantiles(min: number, max: number, typical: number, spread: number): number[] {
  if (!(max > min) || !(spread > 0)) return evenQuantiles(min, max);
  const lo = normalCdf((min - typical) / spread);
  const hi = normalCdf((max - typical) / spread);
  if (!(hi - lo > 1e-12)) return evenQuantiles(min, max);
  const out = new Array<number>(101);
  for (let i = 0; i <= 100; i++) {
    const u = lo + ((hi - lo) * i) / 100;
    const z = i === 0 || i === 100 ? (i === 0 ? (min - typical) / spread : (max - typical) / spread) : normalQuantile(u);
    out[i] = Math.min(max, Math.max(min, typical + spread * z));
  }
  out[0] = min;
  out[100] = max;
  // Rounding in the tails must never break the order the spec requires.
  for (let i = 1; i <= 100; i++) if (out[i] < out[i - 1]) out[i] = out[i - 1];
  return out;
}

export const meanOf = (q: readonly number[]): number => q.reduce((a, b) => a + b, 0) / q.length;

export function sdOf(q: readonly number[]): number {
  const m = meanOf(q);
  return Math.sqrt(q.reduce((a, b) => a + (b - m) ** 2, 0) / q.length);
}

/** Whole numbers that add up to `total`, in proportion to `weights` (largest remainder, ties to the earlier). */
export function apportion(weights: readonly number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0) || total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / sum) * total);
  const counts = exact.map(Math.floor);
  let left = total - counts.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, rest: e - Math.floor(e) })).sort((x, y) => y.rest - x.rest || x.i - y.i);
  for (let k = 0; left > 0; k++, left--) counts[order[k % order.length].i]++;
  return counts;
}
