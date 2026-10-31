// Turns a loaded table into column profiles: collect statistics, classify, finish dates, then
// compute the type-specific summary with exact numbers from the full table (FR-005 to FR-009).
// Runs against an abstract SqlRunner, so it works in the browser worker and in Node tests.

import { classifyColumn, DEFAULT_THRESHOLD, resolveDate } from "../../lib/classify/classify";
import { detectNa, withExtraTokens, type NaInfo } from "../../lib/classify/na";
import { detectSentinels } from "../../lib/classify/sentinels";
import type { BasicStats } from "../../lib/classify/stats";
import { patternKind, toDuckdbPattern } from "../../lib/datefmt/directives";
import { fitBeta } from "../../lib/sampling";
import type {
  ColumnProfile,
  ColumnSummary,
  ColumnType,
  NumericSummary,
  ReasonCode,
} from "../../lib/profile/types";
import { collectBasic, createSample, isValue } from "./stats";
import { ident, lit, litList, QUANTILE_LIST, SRC, toNumber, toNumberArray, type SqlRunner } from "./sql";

/** Until ID masks land (task T065/T068) survey IDs are detected but left out of the output. */
const SURVEY_ID_GENERATION_READY = false;

export interface ProfileOptions {
  /** Distinct-value limit for categorical. */
  threshold: number;
  /** Per column: did the source quote its non-empty fields (from the dialect sniffer). */
  quoted?: readonly boolean[];
}

/** Settings the user can change on the Review screen; each triggers a re-profile of one column. */
export interface ColumnOverrides {
  /** Confirmed sentinel codes (replaces the proposed ones). */
  sentinels?: string[];
  /** A date pattern typed by the user. */
  datePattern?: string;
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
function dataCondition(col: string, extraTokens: readonly string[], sentinelKeys: readonly string[]): string {
  const notSentinel = sentinelKeys.length > 0 ? ` AND ${col} NOT IN (${litList(sentinelKeys)})` : "";
  return `${isValue(col, extraTokens)}${notSentinel}`;
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
    decimals = toNumber(d.d);
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

/** Profiles one column. */
export async function profileColumn(
  sql: SqlRunner,
  name: string,
  rowCount: number,
  options: ProfileOptions = { threshold: DEFAULT_THRESHOLD },
  overrides: ColumnOverrides = {},
  precomputed?: BasicStats,
): Promise<ColumnProfile> {
  const c = ident(name);
  const basic = precomputed ?? (await collectBasic(sql, name, rowCount));
  const na0 = detectNa(basic);
  const sentinels = overrides.sentinels ? await countValues(sql, c, overrides.sentinels) : detectSentinels(basic);
  const sentinelKeys = Object.keys(sentinels);

  const cls = classifyColumn(basic, na0, sentinels, options);
  let type = cls.type;
  let status = cls.status;
  const reasons: ReasonCode[] = [...cls.reasons];
  let na: NaInfo = cls.na;
  let extraTokens = (cls.extraNa ?? []).map((v) => v.value);
  let datePattern: string | null = null;

  // Dates: try the candidate patterns on every value and let the rules pick.
  if (cls.type === "date" && (cls.datePatterns || overrides.datePattern)) {
    const patterns = overrides.datePattern ? [overrides.datePattern] : (cls.datePatterns as string[]);
    const where = dataCondition(c, [], sentinelKeys);
    const { parsed, total } = await parseCounts(sql, c, patterns, where);
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
    if (reasons.length > 0 && status === "ok") status = "needs_attention";
  }

  const where = dataCondition(c, extraTokens, sentinelKeys);
  let summary: ColumnSummary = { kind: "unsupported" };
  let mode: ColumnProfile["mode"];

  switch (type) {
    case "empty":
      summary = { kind: "empty" };
      break;

    case "boolean":
    case "categorical": {
      const rows = await sql.all(
        `SELECT ${c} AS v, count(*) AS n FROM ${SRC} WHERE ${where} GROUP BY ${c} ORDER BY n DESC, v LIMIT ${options.threshold + 1}`,
      );
      const counts: Record<string, number> = {};
      for (const r of rows) counts[String(r.v)] = toNumber(r.n);
      summary = { kind: "categorical", storage: cls.storage ?? "string", counts };
      break;
    }

    case "integer":
    case "float": {
      const expr = cls.thousands ? `try_cast(replace(${c}, ',', '') AS DOUBLE)` : `try_cast(${c} AS DOUBLE)`;
      const scientific = type === "float" && basic.sciCount > 0 && basic.sciCount >= basic.valueCount * 0.5;
      const num = await numericSummary(sql, expr, where, type === "float" ? c : undefined, scientific);
      summary = { kind: "numeric", ...num, ...(cls.thousands ? { thousands: true } : {}) };
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

    case "survey_id":
      // Real masks arrive with the ID work; until then only the shape of the column is kept.
      summary = {
        kind: "survey_id",
        mask: [],
        repeatStructure: {},
        distinct: Math.max(0, basic.distinct - Object.keys(basic.tokenCounts).length - sentinelKeys.length),
      };
      break;

    default:
      summary = { kind: "unsupported" };
  }

  // Numeric modes: match mean and sd by default, uniform when no beta can fit (FR-011).
  if (summary.kind === "numeric" || summary.kind === "datetime") {
    const fit = fitBeta(summary.mean, summary.sd, summary.min, summary.max);
    if (fit) mode = "match_mean_sd";
    else {
      mode = "uniform";
      if (summary.sd > 0 && summary.max > summary.min) reasons.push("beta_fit_failed");
    }
  }

  if (type === "survey_id" && !SURVEY_ID_GENERATION_READY) {
    reasons.push("id_not_yet_supported");
    status = "needs_attention";
  }
  if (reasons.length > 0 && status === "ok") status = "needs_attention";

  const exclude: ColumnProfile["exclude"] =
    type === "unsupported" || (type === "survey_id" && !SURVEY_ID_GENERATION_READY) ? "drop" : "include";

  return {
    name,
    outputName: name,
    detectedType: type,
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
): Promise<ColumnProfile[]> {
  await createSample(sql, rowCount);
  const profiles: ColumnProfile[] = [];
  for (let i = 0; i < columnNames.length; i++) {
    if (isCancelled()) break;
    const profile = await profileColumn(sql, columnNames[i], rowCount, options);
    profile.quoted = options.quoted?.[i] ?? false;
    profiles.push(profile);
    onProgress?.({ done: i + 1, total: columnNames.length });
  }
  return profiles;
}

