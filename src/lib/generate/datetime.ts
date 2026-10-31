// Date, datetime and time columns (FR-024): generated as numbers (days, seconds since the epoch, or
// seconds since midnight), then written back in the original string format and granularity.

import { formatDate, fromNumber, patternKind, type Granularity, type PatternKind } from "../datefmt/directives";

export interface DateFormatter {
  kind: PatternKind;
  /** Rounds a raw number to the column's granularity. */
  round: (n: number) => number;
  /** Writes a (rounded) number in the original pattern. */
  format: (n: number) => string;
}

export function makeDateFormatter(pattern: string, granularity: Granularity): DateFormatter {
  const kind = patternKind(pattern);
  // One unit in the numeric scale: a day for dates, otherwise seconds scaled to the granularity.
  const unit = kind === "date" ? 1 : granularity === "minute" ? 60 : granularity === "day" ? 86400 : 1;
  return {
    kind,
    round: (n) => Math.round(n / unit) * unit,
    format: (n) => formatDate(fromNumber(n, kind), pattern),
  };
}
