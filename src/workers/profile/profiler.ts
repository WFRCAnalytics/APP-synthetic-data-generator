// Turns a loaded table into column profiles: collect statistics, classify, finish dates, then
// compute the type-specific summary with exact numbers from the full table (FR-005 to FR-009).
// Runs against an abstract SqlRunner, so it works in the browser worker and in Node tests.

import { classifyColumn, DEFAULT_THRESHOLD, personalKindFromName, resolveDate } from "../../lib/classify/classify";
import { detectNa, withExtraTokens, type NaInfo } from "../../lib/classify/na";
import { detectSentinels } from "../../lib/classify/sentinels";
import { KNOWN_NA_TOKENS, type BasicStats } from "../../lib/classify/stats";
import { isSupportedPattern, patternKind, toDuckdbPattern } from "../../lib/datefmt/directives";
import { fitBeta } from "../../lib/sampling";
import type {
  ColumnOverrides,
  ColumnProfile,
  ColumnSummary,
  ColumnType,
  NumericSummary,
  ReasonCode,
} from "../../lib/profile/types";
import { shortStringFit } from "../../lib/profile/idCapacity";
import { needsSuffix } from "../../lib/textgen/space";
import { MAX_TEXT_LENGTH } from "../../lib/spec/types";
import type { PersonalKind } from "../../lib/spec/types";
import { profileIds } from "./ids";
import { freeTextFlags, profilePersonal, profileShortString } from "./personal";
import { collectBasic, createSample, isValue } from "./stats";
import { ident, lit, litList, QUANTILE_LIST, SRC, toNumber, toNumberArray, type SqlRunner } from "./sql";

export interface ProfileOptions {
  /** Distinct-value limit for categorical. */
  threshold: number;
  /** Per column: did the source quote its non-empty fields (from the dialect sniffer). */
  quoted?: readonly boolean[];
}

type DateType = Extract<ColumnType, "date" | "datetime" | "time">;
const kindOf = (pattern: string): ColumnType => patternKind(pattern) as DateType;

/** Exact counts for a fixed set of values (used for user-confirmed sentinels). */
async function countValues(sql: SqlRunner, col: string, values: readonly string[]): Promise<Record<string, number>> {
  if (values.length === 0) return {};
  const rows = await sql.all(`SELECT ${col} AS v, count(*) AS n FROM ${SRC} WHERE ${col} IN (${litList(values)}) GROUP BY ${col}`);
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.v)] = toNumber(r.n);
  return out;
}

/** Condition selecting the values that belong to the data: not NA, not a sentinel. */
function dataCondition(col: string, naTokens: readonly string[], sentinelKeys: readonly string[]): string {
  const notSentinel = sentinelKeys.length > 0 ? ` AND ${col} NOT IN (${litList(sentinelKeys)})` : "";
  return `${isValue(col, naTokens)}${notSentinel}`;
}

/** How many values each candidate date pattern parses. */
async function parseCounts(sql: SqlRunner, col: string, patterns: readonly string[], where: string) {
  const selects = patterns.map(
    (p, i) => `count(*) FILTER (WHERE try_strptime(${col}, ${lit(toDuckdbPattern(p))}) IS NOT NULL) AS p${i}`,
  );
  const [row] = await sql.all(`SELECT ${selects.join(", ")}, count(*) AS total FROM ${SRC} WHERE ${where}`);
  return {
    parsed: patterns.map((pattern, i) => ({ pattern, parsed: toNumber(row[`p${i}`]) })),
    total: toNumber(row.total),
  };
}

// SQL expression for the number a date-like value stands for (research.md R8): days since the
// epoch, seconds since the epoch, or seconds since midnight.
function dateNumberExpr(col: string, pattern: string): string {
  const ts = `try_strptime(${col}, ${lit(toDuckdbPattern(pattern))})`;
  switch (patternKind(pattern)) {
    case "date":
      return `floor(epoch(${ts}) / 86400)`;
    case "datetime":
      return `epoch(${ts})`;
    default:
      return `(epoch(${ts}) - epoch(date_trunc('day', ${ts})))`;
  }
}

async function numericSummary(
  sql: SqlRunner,
  valueExpr: string,
  where: string,
  decimalsFrom?: string,
  scientific = false,
): Promise<NumericSummary> {
  const base = `WITH v AS (SELECT ${valueExpr} AS x FROM ${SRC} WHERE ${where}) `;
  const [r] = await sql.all(
    `${base}SELECT count(x) AS n, min(x) AS mn, max(x) AS mx, avg(x) AS mean, stddev_pop(x) AS sd, quantile_cont(x, ${QUANTILE_LIST}) AS q FROM v WHERE x IS NOT NULL`,
  );
  const n = toNumber(r.n);
  if (n === 0) {
    return { min: 0, max: 0, mean: 0, sd: 0, decimals: 0, quantiles: new Array(101).fill(0), histogram: new Array(20).fill(0) };
  }
  const min = toNumber(r.mn);
  const max = toNumber(r.mx);

  const histogram = new Array<number>(20).fill(0);
  if (max > min) {
    const rows = await sql.all(
      `${base}SELECT least(19, CAST(floor((x - ${min}) / ${max - min} * 20) AS INTEGER)) AS b, count(*) AS n FROM v WHERE x IS NOT NULL GROUP BY b`,
    );
    for (const row of rows) histogram[toNumber(row.b)] = toNumber(row.n);
  } else histogram[0] = n;

  let decimals = 0;
  if (decimalsFrom) {
    // For scientific notation the decimals that matter are the mantissa's (1.25e-5 has two).
    const pattern = scientific ? String.raw`'^[+-]?\d+\.(\d+)[eE]'` : String.raw`'\.(\d+)'`;
    const [d] = await sql.all(
      `SELECT coalesce(max(length(regexp_extract(${decimalsFrom}, ${pattern}, 1))), 0) AS d FROM ${SRC} WHERE ${where}`,
    );
    // Fifteen digits is the most a double holds reliably, and the spec's limit.
    decimals = Math.min(15, toNumber(d.d));
  }

  // Floating-point error can put the mean or a percentile a hair outside [min, max], or make the
  // percentiles dip; the spec requires them ordered and inside the range.
  const clamp = (x: number) => Math.min(max, Math.max(min, x));
  let floor = min;
  const quantiles = toNumberArray(r.q).map((q) => (floor = Math.max(floor, clamp(q))));

  return {
    min,
    max,
    mean: clamp(toNumber(r.mean)),
    sd: toNumber(r.sd),
    decimals,
    quantiles,
    histogram,
    ...(scientific ? { scientific: true } : {}),
  };
}

/** The most labels a column the user forces to categorical may have. */
export const MAX_FORCED_LABELS = 2000;

/** Short string patterns hold at most this many positions (longer values are free text). */
export const MAX_SHORT_STRING_LENGTH = 64;

interface Forced {
  type: ColumnType;
  storage?: "integer" | "string";
  thousands?: boolean;
  /** Stray non-numeric markers to treat as missing (numeric types only). */
  extraNa?: { value: string; count: number }[];
}

/**
 * Applies a type the user chose, or returns null when the column's values cannot honestly be read
 * that way (for example a number type for a column of words). Dates are chosen by typing a pattern.
 */
function forceType(target: ColumnType, basic: BasicStats, sentinelKeys: readonly string[]): Forced | null {
  const distinctValues = Math.max(0, basic.distinct - Object.keys(basic.tokenCounts).length - sentinelKeys.length);
  switch (target) {
    case "unsupported":
      return { type: "unsupported" };

    case "categorical":
    case "boolean": {
      if (distinctValues > MAX_FORCED_LABELS) return null;
      if (target === "boolean" && distinctValues !== 2) return null;
      const plainInteger = basic.intCount === basic.valueCount && basic.leadingZeroCount === 0 && basic.thousandsCount === 0;
      return { type: target, storage: target === "boolean" ? "string" : plainInteger ? "integer" : "string" };
    }

    case "integer":
    case "float": {
      const numeric = basic.floatCount + basic.thousandsCount;
      if (numeric === 0 || basic.leadingZeroCount > 0) return null;
      // A few stray markers can be read as missing; many mean the column is not numeric.
      if (basic.unparsedCount > 0 && basic.unparsedDistinct > 5) return null;
      if (target === "integer" && !(basic.sciCount === 0 && basic.intCount + basic.thousandsCount === basic.valueCount - basic.unparsedCount)) return null;
      return {
        type: target,
        thousands: basic.thousandsCount > 0 && basic.plainBigCount === 0,
        extraNa: basic.unparsedCount > 0 ? basic.unparsedTop : undefined,
      };
    }

    case "personal":
      return { type: "personal" };

    case "free_text":
      return { type: "free_text" };

    case "short_string":
      return basic.maxLength > MAX_SHORT_STRING_LENGTH ? null : { type: "short_string" };

    default:
      return null; // dates need a pattern; empty and survey_id are not offered as choices
  }
}

/** How many values a typed date pattern parses, among the values that belong to the data. */
export async function countDatePattern(
  sql: SqlRunner,
  name: string,
  pattern: string,
  naTokens: readonly string[],
  sentinels: readonly string[],
): Promise<{ parsed: number; total: number }> {
  const c = ident(name);
  const { parsed, total } = await parseCounts(sql, c, [pattern], dataCondition(c, naTokens, sentinels));
  return { parsed: parsed[0].parsed, total };
}

/** Profiles one column, with any settings the user changed applied. */
export async function profileColumn(
  sql: SqlRunner,
  name: string,
  rowCount: number,
  options: ProfileOptions = { threshold: DEFAULT_THRESHOLD },
  overrides: ColumnOverrides = {},
): Promise<ColumnProfile> {
  const c = ident(name);
  const naList = overrides.naTokens ?? [...KNOWN_NA_TOKENS];
  const basic = await collectBasic(sql, name, rowCount, naList, options.threshold);
  const na0 = detectNa(basic);
  const sentinels = overrides.sentinels ? await countValues(sql, c, overrides.sentinels) : detectSentinels(basic);
  const sentinelKeys = Object.keys(sentinels);

  const cls = classifyColumn(basic, na0, sentinels, options);
  let type: ColumnType = cls.type;
  let status = cls.status;
  const reasons: ReasonCode[] = [...cls.reasons];
  let na: NaInfo = cls.na;
  let extraTokens = (cls.extraNa ?? []).map((v) => v.value);
  let datePattern: string | null = null;
  let storage = cls.storage;
  let thousands = cls.thousands;
  let forcedLabels = false;

  if (overrides.datePattern) {
    // The user typed a pattern: it must parse every value, otherwise the column is not supported (Q2).
    const pattern = overrides.datePattern;
    const supported = isSupportedPattern(pattern);
    const { parsed, total } = supported ? await parseCounts(sql, c, [pattern], dataCondition(c, naList, sentinelKeys)) : { parsed: [{ pattern, parsed: 0 }], total: 0 };
    reasons.length = 0;
    if (supported && total > 0 && parsed[0].parsed === total) {
      type = kindOf(pattern);
      datePattern = pattern;
      status = "ok";
    } else {
      type = "unsupported";
      status = "unsupported";
      reasons.push("unsupported_type", "date_format_unrecognized");
    }
    if (sentinelKeys.length > 0 && type !== "unsupported") reasons.push("possible_sentinel");
  } else if (cls.type === "date" && cls.datePatterns) {
    // Dates: try the candidate patterns on every value and let the rules pick.
    const where = dataCondition(c, naList, sentinelKeys);
    const { parsed, total } = await parseCounts(sql, c, cls.datePatterns, where);
    const topData = basic.topValues.filter((v) => !(v.value in sentinels));
    const res = resolveDate(parsed, total, topData, kindOf);
    type = res.type;
    status = res.status;
    reasons.length = 0;
    reasons.push(...res.reasons);
    datePattern = res.pattern;
    if (res.extraNa) {
      na = withExtraTokens(na, res.extraNa);
      extraTokens = res.extraNa.map((v) => v.value);
    }
    if (sentinelKeys.length > 0) reasons.push("possible_sentinel");
  } else if (overrides.type && overrides.type !== cls.type) {
    // A type the user chose instead of the detected one, when the values allow it.
    const forced = forceType(overrides.type, basic, sentinelKeys);
    if (forced) {
      type = forced.type;
      storage = forced.storage;
      thousands = forced.thousands;
      forcedLabels = type === "categorical" || type === "boolean";
      reasons.length = 0;
      status = type === "unsupported" ? "unsupported" : "ok";
      if (type === "unsupported") reasons.push("unsupported_type");
      if (sentinelKeys.length > 0 && type !== "unsupported") reasons.push("possible_sentinel");
      if (forced.extraNa) {
        na = withExtraTokens(na0, forced.extraNa);
        extraTokens = forced.extraNa.map((v) => v.value);
        reasons.push("possible_na_token");
      }
    } else {
      reasons.push("override_not_possible");
    }
  }

  const where = dataCondition(c, [...naList, ...extraTokens], sentinelKeys);
  let summary: ColumnSummary = { kind: "unsupported" };
  let mode: ColumnProfile["mode"];

  switch (type) {
    case "empty":
      summary = { kind: "empty" };
      break;

    case "boolean":
    case "categorical": {
      const limit = forcedLabels ? MAX_FORCED_LABELS + 1 : options.threshold + 1;
      const rows = await sql.all(`SELECT ${c} AS v, count(*) AS n FROM ${SRC} WHERE ${where} GROUP BY ${c} ORDER BY n DESC, v LIMIT ${limit}`);
      const counts: Record<string, number> = {};
      for (const r of rows) counts[String(r.v)] = toNumber(r.n);
      summary = { kind: "categorical", storage: storage ?? "string", counts };
      break;
    }

    case "integer":
    case "float": {
      const expr = thousands ? `try_cast(replace(${c}, ',', '') AS DOUBLE)` : `try_cast(${c} AS DOUBLE)`;
      const scientific = type === "float" && basic.sciCount > 0 && basic.sciCount >= basic.valueCount * 0.5;
      const num = await numericSummary(sql, expr, where, type === "float" ? c : undefined, scientific);
      summary = { kind: "numeric", ...num, ...(thousands ? { thousands: true } : {}) };
      break;
    }

    case "date":
    case "datetime":
    case "time": {
      const pattern = datePattern as string;
      const num = await numericSummary(sql, dateNumberExpr(c, pattern), where);
      const granularity = patternKind(pattern) === "date" ? "day" : /%S/.test(pattern) ? "second" : "minute";
      summary = { kind: "datetime", format: pattern, granularity, ...num };
      break;
    }

    case "personal": {
      const kind: PersonalKind = cls.personalKind ?? personalKindFromName(name);
      const agg = await profilePersonal(sql, c, where, kind);
      summary = { kind: "personal", personalKind: kind, repeatStructure: agg.repeatStructure, distinct: agg.distinct, ...(agg.format ? { format: agg.format } : {}) };
      if (needsSuffix(kind, agg.distinct)) reasons.push("suffix_needed");
      break;
    }

    case "free_text": {
      // Length in characters, capped; exact min and max come from the full table.
      const num = await numericSummary(sql, `least(length(${c}), ${MAX_TEXT_LENGTH})`, where);
      const flags = await freeTextFlags(sql, c, where);
      const { thousands: _thousands, scientific: _scientific, ...length } = num as typeof num & { thousands?: boolean; scientific?: boolean };
      void _thousands;
      void _scientific;
      summary = { kind: "free_text", ...length, decimals: 0, lineBreaks: flags.lineBreaks };
      if (flags.capped > 0) reasons.push("text_length_capped");
      break;
    }

    case "short_string": {
      const agg = await profileShortString(sql, c, where);
      summary = { kind: "short_string", pattern: agg.pattern, lengthGroups: agg.lengthGroups, repeatStructure: agg.repeatStructure, distinct: agg.distinct };
      break;
    }

    case "survey_id": {
      // A pattern, a min and max for whole numbers, and the repeat structure: no ID value is kept.
      const ids = await profileIds(sql, name, where);
      const { mixedLengths, ...idSummary } = ids;
      summary = { kind: "survey_id", ...idSummary };
      if (mixedLengths) reasons.push("id_mixed_masks");
      break;
    }

    default:
      // An SSN-style column is unsupported until acknowledged, but keeps its figures so that the
      // acknowledgement on Review can switch it on without profiling again.
      if (cls.personalKind === "ssn") {
        const agg = await profilePersonal(sql, c, where, "ssn");
        summary = { kind: "personal", personalKind: "ssn", repeatStructure: agg.repeatStructure, distinct: agg.distinct, ...(agg.format ? { format: agg.format } : {}) };
      } else summary = { kind: "unsupported" };
  }

  // Numeric modes: match mean and sd by default, uniform when no beta can fit (FR-011).
  if (summary.kind === "numeric" || summary.kind === "datetime" || summary.kind === "free_text") {
    const fit = fitBeta(summary.mean, summary.sd, summary.min, summary.max);
    if (fit) mode = "match_mean_sd";
    else {
      mode = "uniform";
      if (summary.sd > 0 && summary.max > summary.min) reasons.push("beta_fit_failed");
    }
  }

  // An ID with no readable pattern cannot be generated, so it is left out like any unsupported column.
  const noPattern = summary.kind === "survey_id" && summary.mask.length === 0;
  if (noPattern) reasons.push("id_mixed_masks");
  // A short string whose pattern cannot hold its distinct values (punctuation that varies, say) is
  // left out until the user widens the pattern on Review.
  const narrowShort = summary.kind === "short_string" && shortStringFit({ summary } as ColumnProfile)?.short === true;
  if (narrowShort) reasons.push("id_mask_too_narrow");
  if (reasons.length > 0 && status === "ok") status = "needs_attention";

  const exclude: ColumnProfile["exclude"] = type === "unsupported" || noPattern || narrowShort ? "drop" : "include";

  return {
    name,
    outputName: name,
    detectedType: cls.type,
    type,
    status,
    attentionReasons: [...new Set(reasons)],
    naTokens: na.tokens,
    naCount: na.count,
    naByToken: na.byToken,
    sentinels,
    exclude,
    quoted: false,
    mode,
    summary,
  };
}

export interface ProgressReport {
  done: number;
  total: number;
}

/** Profiles every column of the loaded table, reporting progress after each. */
export async function profileAll(
  sql: SqlRunner,
  columnNames: readonly string[],
  rowCount: number,
  options: ProfileOptions,
  onProgress?: (p: ProgressReport) => void,
  isCancelled: () => boolean = () => false,
  overrides: Record<string, ColumnOverrides> = {},
): Promise<ColumnProfile[]> {
  await createSample(sql, rowCount);
  const profiles: ColumnProfile[] = [];
  for (let i = 0; i < columnNames.length; i++) {
    if (isCancelled()) break;
    const profile = await profileColumn(sql, columnNames[i], rowCount, options, overrides[columnNames[i]]);
    profile.quoted = options.quoted?.[i] ?? false;
    profiles.push(profile);
    onProgress?.({ done: i + 1, total: columnNames.length });
  }
  return profiles;
}

