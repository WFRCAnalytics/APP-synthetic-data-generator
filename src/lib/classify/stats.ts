// What profiling collects about one column before it is classified. These are aggregates only:
// counts, a few frequent values, and character-shape counts. Real rows never appear here
// (constitution Principle I). The SQL that fills this in lives in workers/profile/stats.ts; the
// rules that read it live in the other files of this folder and need no database.

export interface ValueCount {
  value: string;
  count: number;
}

export interface ShapeCount {
  /** A value with every digit shown as 9 and every letter as A, for example AA-999-999. */
  shape: string;
  count: number;
}

export interface BasicStats {
  name: string;
  rowCount: number;
  /** Empty fields. */
  nullCount: number;
  /** Known NA tokens found in the column (not counting empty fields), each with its exact count. */
  tokenCounts: Record<string, number>;
  /** Distinct non-empty values, including NA tokens. */
  distinct: number;
  /** Non-empty values that are not NA tokens. */
  valueCount: number;
  /** The most frequent such values, exact counts. */
  topValues: ValueCount[];
  /** Shapes from a random sample of the values. */
  shapes: ShapeCount[];
  shapeSample: number;
  /** Values that parse as whole numbers (no decimal point, no separators). */
  intCount: number;
  /** Values that parse as finite numbers. */
  floatCount: number;
  /** Values written like 1,234 or 1,234.5. */
  thousandsCount: number;
  /** Plain integers of four or more digits that have no thousands separator. */
  plainBigCount: number;
  /** Values with leading zeros, such as 01 or 007. */
  leadingZeroCount: number;
  /** Values in scientific notation. */
  sciCount: number;
  /** Values that are neither numbers nor thousands-formatted numbers. */
  unparsedCount: number;
  /** The most frequent of those, so a few stray tokens can be recognized as NA markers. */
  unparsedTop: ValueCount[];
  unparsedDistinct: number;
  /** How many numeric values are negative. */
  negativeCount: number;
  /** 99th percentile of non-negative numbers, leaving out 9-pattern codes (9, 99, 998, 999 ...). */
  p99: number | null;
  minLength: number;
  maxLength: number;
  meanLength: number;
  /** Values that contain a space (full table). */
  spaceCount?: number;
  /** Values that contain a line break (full table). */
  lineBreakCount?: number;
}

/** NA tokens recognized in the data. Empty fields are always treated as NA too. */
export const KNOWN_NA_TOKENS: readonly string[] = [
  "NA",
  "N/A",
  "n/a",
  "NULL",
  "null",
  "NaN",
  "nan",
  ".",
  "#N/A",
  "None",
  "none",
];
