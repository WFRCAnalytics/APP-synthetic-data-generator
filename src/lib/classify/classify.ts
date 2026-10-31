// Type detection (FR-005, FR-006, SPEC.md "Type detection"): the first matching rule in table order
// picks a column's type. Pure rules over collected statistics, so they are testable without a
// database. Real values never enter this module except the handful of frequent ones in `topValues`
// (labels and sentinel candidates, which the privacy model allows in the spec).
//
// Safety rules that matter most:
//  - Anything that looks like personal data, free text or a coordinate becomes `unsupported`, so
//    its values can never reach the preview, the spec or the export (Principle I and II).
//  - A column named like an ID is a survey ID before it can be categorical, so a household ID with
//    few distinct values is never stored as category labels.

import { parseDate } from "../datefmt/directives";
import type { ColumnStatus, ColumnType, ReasonCode } from "../profile/types";
import { withExtraTokens, type NaInfo } from "./na";
import type { BasicStats, ShapeCount, ValueCount } from "./stats";

export interface ClassifyOptions {
  /** Distinct-value limit for categorical, default 50 (FR-006). */
  threshold: number;
}

export interface Classification {
  type: ColumnType;
  status: ColumnStatus;
  reasons: ReasonCode[];
  /** Categorical and boolean columns. */
  storage?: "integer" | "string";
  /** Integer columns written as 1,234. */
  thousands?: boolean;
  /** Date-like columns: patterns to try against the full data (see resolveDate). */
  datePatterns?: string[];
  /** Stray non-numeric markers in a numeric column, treated as extra NA tokens. */
  extraNa?: ValueCount[];
  na: NaInfo;
}

export const DEFAULT_THRESHOLD = 50;

// "hh_id", "HH_ID", "hhId", "HOUSEID", "case_num", "id". Words that merely end in id (paid, valid)
// do not match, so each pattern carries its own case rule.
const ID_NAME_PATTERNS = [/(^|[^A-Za-z])id$/i, /[a-z]Id$/, /^[A-Z0-9]{4,}ID$/, /_num$/i];
export const isIdName = (name: string) => ID_NAME_PATTERNS.some((r) => r.test(name));
const TIME_NAME = /time|hhmm|hour|depart|arriv|start|end|(^|_)tm$/i;
const PERSONAL_NAME = /(^|[^a-z])(e_?mail|phone|tel|telephone|mobile|ssn|name|address|street)([^a-z]|$)/i;
const LAT_LON_NAME = /(^|[^a-z])(lat|latitude|lon|lng|long|longitude)([^a-z]|$)/i;

const BOOLEAN_PAIRS: string[][] = [
  ["true", "false"],
  ["yes", "no"],
  ["y", "n"],
  ["t", "f"],
  ["0", "1"],
];

// Character shapes (digits as 9, letters as A) that are recognizably dates or times, with the
// patterns to try for each.
const SHAPE_PATTERNS: Record<string, string[]> = {
  "9999-99-99": ["%Y-%m-%d"],
  "99/99/9999": ["%m/%d/%Y", "%d/%m/%Y"],
  "99-AAA-9999": ["%d-%b-%Y"],
  "9999-99-99A99:99:99": ["%Y-%m-%dT%H:%M:%S"],
  "9999-99-99 99:99:99": ["%Y-%m-%d %H:%M:%S"],
  "99/99/9999 99:99:99 AA": ["%m/%d/%Y %I:%M:%S %p", "%d/%m/%Y %I:%M:%S %p"],
  "99:99": ["%H:%M"],
  "99:99:99": ["%H:%M:%S"],
};

const EMAIL_SHAPE = /@/;
const PHONE_SHAPES = [/^\(?9{3}\)?[ .-]?9{3}[ .-]9{4}/, /^\+9{1,3}[ -]9[9 -]+$/];
const SSN_SHAPE = /^9{3}-9{2}-9{4}$/;
const TZ_SHAPE = /(\d{2}:\d{2}|9{2}:9{2})[+-]9{2}:9{2}$|[+-]9{2}:9{2}$|9Z$|AZ$/;
const COORD_SHAPES = [/^\(9+\.9+, -?9+\.9+\)$/, /^POINT/i, /^\(-?9+\.9+, -?9+\.9+\)$/];

function shareOf(shapes: ShapeCount[], sample: number, test: (s: string) => boolean): number {
  if (sample === 0) return 0;
  return shapes.filter((s) => test(s.shape)).reduce((a, s) => a + s.count, 0) / sample;
}

function unsupported(na: NaInfo, reasons: ReasonCode[] = []): Classification {
  return { type: "unsupported", status: "unsupported", reasons: ["unsupported_type", ...reasons], na };
}

function pairMatches(values: string[]): boolean {
  const lower = new Set(values.map((v) => v.toLowerCase()));
  return BOOLEAN_PAIRS.some((p) => p.length === lower.size && p.every((x) => lower.has(x)));
}

/** Patterns worth trying for a column whose shapes look like dates or times. */
function datePatternsFor(stats: BasicStats): string[] {
  const patterns = new Set<string>();
  for (const { shape } of stats.shapes) for (const p of SHAPE_PATTERNS[shape] ?? []) patterns.add(p);
  if (patterns.size === 0 && TIME_NAME.test(stats.name)) {
    // Four digits such as 0815 are only read as a clock time when the name says so.
    if (shareOf(stats.shapes, stats.shapeSample, (s) => s === "9999") > 0.9) patterns.add("%H%M");
  }
  return [...patterns];
}

/**
 * Decides a column's type from its statistics. Date-like columns come back with candidate
 * patterns; call resolveDate with their parse counts to finish them.
 */
export function classifyColumn(
  stats: BasicStats,
  na: NaInfo,
  sentinels: Record<string, number>,
  options: ClassifyOptions = { threshold: DEFAULT_THRESHOLD },
): Classification {
  const reasons: ReasonCode[] = [];
  const sentinelKeys = Object.keys(sentinels);
  const sentinelCount = Object.values(sentinels).reduce((a, b) => a + b, 0);
  const values = stats.valueCount - sentinelCount;
  const distinctValues = Math.max(0, stats.distinct - Object.keys(stats.tokenCounts).length - sentinelKeys.length);
  const flagSentinel = () => {
    if (sentinelKeys.length > 0) reasons.push("possible_sentinel");
  };
  const done = (type: ColumnType, extra: Partial<Classification> = {}): Classification => {
    const status: ColumnStatus = type === "unsupported" ? "unsupported" : reasons.length > 0 ? "needs_attention" : "ok";
    return { type, status, reasons: [...reasons], na, ...extra };
  };

  // 1. Empty: every value is NA.
  if (stats.valueCount === 0) return done("empty");

  const numberLike = stats.floatCount + stats.thousandsCount === stats.valueCount;
  const textShare = (test: (s: string) => boolean) => shareOf(stats.shapes, stats.shapeSample, test);

  // A time zone offset is out of scope (research.md R8).
  if (textShare((s) => /9{2}:9{2}/.test(s) && TZ_SHAPE.test(s)) > 0.5) {
    return unsupported(na, ["date_format_unrecognized"]);
  }

  // 2. Boolean: exactly two distinct values forming a known pair.
  if (distinctValues === 2) {
    const labels = stats.topValues.map((v) => v.value).filter((v) => !(v in sentinels));
    if (labels.length === 2 && pairMatches(labels)) {
      flagSentinel();
      return done("boolean", { storage: "string" });
    }
  }

  // 3. Coordinates: named latitude/longitude, or combined "(lat, lon)" and WKT strings.
  if (textShare((s) => COORD_SHAPES.some((r) => r.test(s))) > 0.5) return unsupported(na);
  if (LAT_LON_NAME.test(stats.name) && stats.floatCount > 0 && stats.floatCount >= stats.valueCount * 0.9) {
    return unsupported(na);
  }

  // 4. Dates, datetimes and times.
  const datePatterns = datePatternsFor(stats);
  if (datePatterns.length > 0 && !(numberLike && !TIME_NAME.test(stats.name))) {
    flagSentinel();
    return done("date", { datePatterns }); // resolveDate settles the exact type and format
  }

  // 5. Personal identifiers.
  const emailish = textShare((s) => EMAIL_SHAPE.test(s)) > 0.5;
  const phoneish = textShare((s) => PHONE_SHAPES.some((r) => r.test(s))) > 0.5;
  const ssnish = textShare((s) => SSN_SHAPE.test(s)) > 0.5;
  if (emailish || phoneish || ssnish || (PERSONAL_NAME.test(stats.name) && !numberLike)) {
    return unsupported(na, ["possible_identifier"]);
  }

  // 6. Survey IDs: the name says ID, and the values are whole numbers or short codes.
  if (isIdName(stats.name)) {
    const codeLike = stats.maxLength <= 24 && stats.floatCount === stats.intCount;
    // For an ID column the frequent values are never fetched, so whitespace is judged from the shapes.
    const wholeOrCode = stats.intCount === stats.valueCount || !stats.shapes.some((s) => s.shape.includes(" "));
    if (codeLike && wholeOrCode) {
      const top = stats.shapes[0];
      const dominant = top && stats.shapeSample > 0 ? top.count / stats.shapeSample : 1;
      if (dominant < 0.98) reasons.push("id_mixed_masks");
      return done("survey_id");
    }
  }

  // 7. Categorical: few distinct values (integer or string; decimals stay numeric).
  const integerLike = stats.intCount === stats.valueCount;
  const plainInteger = integerLike && stats.leadingZeroCount === 0 && stats.thousandsCount === 0;
  const decimalLike = !integerLike && stats.floatCount === stats.valueCount;
  if (distinctValues <= options.threshold && !decimalLike) {
    flagSentinel();
    if (plainInteger && Math.abs(distinctValues - options.threshold) <= 1) reasons.push("near_categorical_threshold");
    return done("categorical", { storage: plainInteger ? "integer" : "string" });
  }

  // 8-9. Integer and float. A few stray non-numeric markers become extra NA tokens.
  const unparsed = stats.unparsedCount;
  const numeric =
    stats.leadingZeroCount === 0 &&
    stats.floatCount + stats.thousandsCount > 0 &&
    (unparsed === 0 || (stats.unparsedDistinct <= 5 && unparsed < stats.valueCount * 0.2 && stats.floatCount > 0));
  if (numeric && values > 0) {
    flagSentinel();
    let extraNa: ValueCount[] | undefined;
    let naInfo = na;
    if (unparsed > 0) {
      extraNa = stats.unparsedTop;
      naInfo = withExtraTokens(na, extraNa);
      reasons.push("possible_na_token");
    }
    // Integer when every numeric value is a whole number (plain or with thousands separators).
    const isInteger = stats.sciCount === 0 && stats.intCount + stats.thousandsCount === stats.valueCount - unparsed;
    if (isInteger && Math.abs(distinctValues - options.threshold) <= 1) reasons.push("near_categorical_threshold");
    return {
      ...done(isInteger ? "integer" : "float", { extraNa, thousands: stats.thousandsCount > 0 && stats.plainBigCount === 0 }),
      na: naInfo,
    };
  }

  // 10-11. Free text and short strings are not supported in this version.
  return unsupported(na);
}

export interface DateResolution {
  pattern: string | null;
  type: ColumnType;
  status: ColumnStatus;
  reasons: ReasonCode[];
  /** Values the chosen pattern could not parse that are few enough to treat as NA markers. */
  extraNa?: ValueCount[];
}

/**
 * Finishes a date-like column once the candidate patterns have been tried on all of its values.
 * `parsed` is how many of the `total` non-NA, non-sentinel values each pattern parses.
 */
export function resolveDate(
  parsed: { pattern: string; parsed: number }[],
  total: number,
  topValues: ValueCount[],
  kindOf: (pattern: string) => ColumnType,
): DateResolution {
  const full = parsed.filter((p) => p.parsed === total);
  if (full.length > 0) {
    const ambiguous = full.length > 1;
    return {
      pattern: full[0].pattern,
      type: kindOf(full[0].pattern),
      status: ambiguous ? "needs_attention" : "ok",
      reasons: ambiguous ? ["date_format_ambiguous"] : [],
    };
  }

  const ranked = [...parsed].sort((a, b) => b.parsed - a.parsed);
  const best = ranked[0];
  if (!best || best.parsed === 0 || total === 0) {
    return { pattern: null, type: "unsupported", status: "unsupported", reasons: ["unsupported_type", "date_format_unrecognized"] };
  }

  const second = ranked[1];
  if (second && best.parsed + second.parsed >= total * 0.99 && second.parsed > total * 0.05) {
    // Two formats share the column.
    return { pattern: null, type: "unsupported", status: "needs_attention", reasons: ["date_format_mixed"] };
  }

  if (best.parsed >= total * 0.9) {
    // Mostly one format; the rest may be a few repeated markers such as 00/00/0000.
    const stray = topValues.filter((v) => parseDate(v.value, best.pattern) === null);
    const strayTotal = stray.reduce((a, v) => a + v.count, 0);
    const accountedFor = strayTotal === total - best.parsed && stray.length <= 5;
    return {
      pattern: best.pattern,
      type: kindOf(best.pattern),
      status: "needs_attention",
      reasons: ["date_format_unrecognized"],
      extraNa: accountedFor ? stray : undefined,
    };
  }

  return { pattern: null, type: "unsupported", status: "unsupported", reasons: ["unsupported_type", "date_format_unrecognized"] };
}
