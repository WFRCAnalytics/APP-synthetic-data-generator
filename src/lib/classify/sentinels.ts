// Sentinel code candidates (FR-007): values such as -9, -1, 998 or 999 that mean "don't know",
// "refused" or "not applicable". The profiler proposes them; the user confirms or edits them.
// Confirmed sentinels keep their exact counts and are left out of min, max, mean and sd.

import type { BasicStats } from "./stats";

// Codes written as a run of nines, optionally followed by one digit: 99, 999, 9999, 995, 998.
const NINES = /^9{2,}\d?$/;
const NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Proposes sentinels from the frequent values of a column that looks numeric. Two kinds:
 *  - negative values in a column that is otherwise non-negative (-9, -1, -9.99);
 *  - runs of nines sitting well above the rest of the column (998, 999).
 * A value must also repeat, so one natural outlier is never flagged.
 */
export function detectSentinels(
  stats: Pick<BasicStats, "topValues" | "valueCount" | "floatCount" | "negativeCount" | "p99">,
): Record<string, number> {
  const out: Record<string, number> = {};
  const numeric = stats.floatCount;
  if (numeric === 0 || stats.valueCount === 0) return out;

  const minRepeat = Math.max(2, Math.ceil(stats.valueCount * 0.001));
  const negativeShare = stats.negativeCount / numeric;

  for (const { value, count } of stats.topValues) {
    if (!NUMBER.test(value) || count < minRepeat) continue;
    const n = Number(value);

    if (n < 0 && negativeShare < 0.2) {
      out[value] = count;
      continue;
    }
    if (n > 0 && NINES.test(value) && stats.p99 !== null && n > stats.p99 * 1.5) {
      out[value] = count;
    }
  }
  return out;
}
