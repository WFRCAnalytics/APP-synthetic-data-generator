// Numeric columns (FR-011, FR-024): exact real min and max, then the chosen mode for the rest.
// Values come from counter-based draws, so a value depends only on (column, row) and the output is
// the same whatever the chunk size. Two reserved ranks carry the exact min and max.

import { drawUniform, rowRng } from "../rng/counter";
import { betaValue, fitBeta, interpolateQuantile, uniformValue, type BetaFit } from "../sampling";

export interface NumericPlan {
  mode: "uniform" | "match_mean_sd" | "match_shape";
  min: number;
  max: number;
  mean?: number;
  sd?: number;
  quantiles?: number[];
}

/**
 * Returns the raw (unrounded) value for a row. `valueIndex` is the row's rank among the real
 * values; ranks 0 and 1 are the exact min and max, so both appear exactly once.
 */
export function makeNumericSource(plan: NumericPlan, key: number, valueTotal: number): (row: number, valueIndex: number) => number {
  const { min, max } = plan;
  const fit: BetaFit | null =
    plan.mode === "match_mean_sd" && plan.mean !== undefined && plan.sd !== undefined
      ? fitBeta(plan.mean, plan.sd, min, max)
      : null;
  const quantiles = plan.mode === "match_shape" ? plan.quantiles : undefined;

  const clamp = (x: number) => Math.min(max, Math.max(min, x));

  return (row, valueIndex) => {
    if (min === max) return min;
    if (valueIndex === 0) return min;
    if (valueIndex === 1 && valueTotal >= 2) return max;

    if (fit) return clamp(betaValue(rowRng(key, row), fit, min, max));
    if (quantiles && quantiles.length >= 2) return clamp(interpolateQuantile(quantiles, drawUniform(key, row)));
    return clamp(uniformValue(drawUniform(key, row), min, max));
  };
}

/** Adds thousands separators to a plain integer string: 1234567 -> 1,234,567. */
export function withThousands(text: string): string {
  const negative = text.startsWith("-");
  const digits = negative ? text.slice(1) : text;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `-${grouped}` : grouped;
}

export interface NumberFormat {
  integer: boolean;
  decimals: number;
  thousands: boolean;
  /** Write as 1.2e-5 instead of fixed decimals. */
  scientific?: boolean;
}

/** Writes a number the way the source wrote it: whole, or with a fixed number of decimals. */
export function formatNumber(x: number, format: NumberFormat): string {
  if (format.scientific) return x.toExponential(format.decimals);
  let text = format.integer ? String(Math.round(x)) : x.toFixed(format.decimals);
  if (/^-0(\.0+)?$/.test(text)) text = text.slice(1); // never write "-0" or "-0.00"
  return format.thousands && format.integer ? withThousands(text) : text;
}
