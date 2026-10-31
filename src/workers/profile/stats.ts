// SQL that collects the aggregates the classifier reads (research.md R3). Everything here is a
// count or a handful of frequent values; no query returns rows of data. Type is decided on a
// random sample (cheap), then exact numbers come from the full table.

import { DEFAULT_THRESHOLD, isIdName } from "../../lib/classify/classify";
import { KNOWN_NA_TOKENS, type BasicStats } from "../../lib/classify/stats";
import { ident, litList, runShapeOf, shapeOf, SMP, SRC, toNumber, toNumberOrNull, type SqlRunner } from "./sql";

export const SAMPLE_ROWS = 50_000;
const TOP_VALUES = 60;
const TOP_SHAPES = 30;
// A date written with digits only (9999-99-99, 99/99/9999, 9:99), as a shape of 9s and separators.
const DIGIT_DATE_SHAPE = /^9{1,4}([-/.: ]9{1,4}){1,5}$/;

/** Condition for "a real value": not empty and not one of the NA tokens. */
export function isValue(col: string, naTokens: readonly string[] = KNOWN_NA_TOKENS): string {
  // With no tokens there is nothing to exclude; "NOT IN (NULL)" would be NULL and drop every row.
  if (naTokens.length === 0) return `${col} IS NOT NULL`;
  return `${col} IS NOT NULL AND ${col} NOT IN (${litList(naTokens)})`;
}

// Regular expressions as SQL strings. String.raw keeps the backslashes DuckDB's regex engine needs.
const RE = {
  wholeNumber: String.raw`'^[+-]?\d+$'`,
  thousands: String.raw`'^-?\d{1,3}(,\d{3})+$'`,
  plainBig: String.raw`'^-?\d{4,}(\.\d+)?$'`,
  leadingZero: String.raw`'^-?0\d'`,
  scientific: String.raw`'^[+-]?\d+(\.\d+)?[eE][+-]?\d+$'`,
  nines: String.raw`'^9{2,}\d?$'`,
};

/** SQL boolean: the value parses as a finite number. */
const finite = (col: string) => `coalesce(isfinite(try_cast(${col} AS DOUBLE)), false)`;

/** Creates the sample table used for type detection (the whole table when it is already small). */
export async function createSample(sql: SqlRunner, rowCount: number): Promise<void> {
  // A previous file in this session may have left it behind, as a table or as a view.
  for (const drop of [`DROP VIEW IF EXISTS ${SMP}`, `DROP TABLE IF EXISTS ${SMP}`]) {
    try {
      await sql.run(drop);
    } catch {
      // dropping the other kind raises a catalog error; the right one succeeds
    }
  }
  if (rowCount <= SAMPLE_ROWS) {
    await sql.run(`CREATE OR REPLACE VIEW ${SMP} AS SELECT * FROM ${SRC}`);
  } else {
    await sql.run(
      `CREATE OR REPLACE TABLE ${SMP} AS SELECT * FROM ${SRC} USING SAMPLE reservoir(${SAMPLE_ROWS} ROWS) REPEATABLE (42)`,
    );
  }
}

/**
 * Collects the classifier's inputs for one column. `naTokens` are the strings that mean "missing"
 * besides the empty field; the defaults unless the user changed them.
 */
export async function collectBasic(
  sql: SqlRunner,
  name: string,
  rowCount: number,
  naTokens: readonly string[] = KNOWN_NA_TOKENS,
  threshold: number = DEFAULT_THRESHOLD,
): Promise<BasicStats> {
  const c = ident(name);
  const value = isValue(c, naTokens);
  // Real ID values must never reach memory (research.md R4), so an ID-named column loads aggregates only.
  const idLike = isIdName(name);

  const [agg] = await sql.all(`
    SELECT
      count(*) FILTER (WHERE ${c} IS NULL) AS null_count,
      count(DISTINCT ${c}) AS distinct_count,
      count(*) FILTER (WHERE ${value}) AS value_count,
      count(*) FILTER (WHERE ${value} AND regexp_matches(${c}, ${RE.wholeNumber}) AND try_cast(${c} AS BIGINT) IS NOT NULL) AS int_count,
      count(*) FILTER (WHERE ${value} AND ${finite(c)}) AS float_count,
      count(*) FILTER (WHERE ${value} AND regexp_matches(${c}, ${RE.thousands})) AS thousands_count,
      count(*) FILTER (WHERE ${value} AND regexp_matches(${c}, ${RE.plainBig})) AS plain_big_count,
      count(*) FILTER (WHERE ${value} AND regexp_matches(${c}, ${RE.leadingZero})) AS leading_zero_count,
      count(*) FILTER (WHERE ${value} AND regexp_matches(${c}, ${RE.scientific})) AS sci_count,
      count(*) FILTER (WHERE ${value} AND NOT (${finite(c)} OR regexp_matches(${c}, ${RE.thousands}))) AS unparsed_count,
      count(DISTINCT ${c}) FILTER (WHERE ${value} AND NOT (${finite(c)} OR regexp_matches(${c}, ${RE.thousands}))) AS unparsed_distinct,
      count(*) FILTER (WHERE ${value} AND ${finite(c)} AND try_cast(${c} AS DOUBLE) < 0) AS negative_count,
      quantile_cont(try_cast(${c} AS DOUBLE), 0.99)
        FILTER (WHERE ${value} AND ${finite(c)} AND try_cast(${c} AS DOUBLE) >= 0 AND NOT regexp_matches(${c}, ${RE.nines})) AS p99,
      coalesce(min(length(${c})) FILTER (WHERE ${value}), 0) AS min_len,
      coalesce(max(length(${c})) FILTER (WHERE ${value}), 0) AS max_len,
      coalesce(avg(length(${c})) FILTER (WHERE ${value}), 0) AS mean_len,
      count(*) FILTER (WHERE ${value} AND position(' ' IN ${c}) > 0) AS space_count,
      count(*) FILTER (WHERE ${value} AND (position(chr(10) IN ${c}) > 0 OR position(chr(13) IN ${c}) > 0)) AS line_break_count
    FROM ${SRC}
  `);

  const shapeRows = await sql.all(
    `SELECT ${shapeOf(c)} AS shape, count(*) AS n FROM ${SMP} WHERE ${value} GROUP BY 1 ORDER BY n DESC, shape LIMIT ${TOP_SHAPES}`,
  );
  const runRows = await sql.all(
    `SELECT ${runShapeOf(c)} AS shape, count(*) AS n FROM ${SMP} WHERE ${value} GROUP BY 1 ORDER BY n DESC, shape LIMIT ${TOP_SHAPES}`,
  );
  const [sample] = await sql.all(`SELECT count(*) AS n FROM ${SMP} WHERE ${value}`);

  // Frequent values are real values, so they are fetched only where they are needed (specs/002 R6):
  // columns with few distinct values (categories, booleans), numeric columns (sentinel codes), and
  // dates written as digits (stray NA markers). A string column with many distinct values, which
  // may hold names, addresses or text, never has a value read.
  const valueCount = toNumber(agg.value_count);
  const numericish = valueCount > 0 && toNumber(agg.float_count) * 2 >= valueCount;
  const digitDateShape = shapeRows.some((r) => DIGIT_DATE_SHAPE.test(String(r.shape)) && toNumber(r.n) >= toNumber(sample.n) * 0.2);
  const fetchTop = !idLike && (toNumber(agg.distinct_count) <= threshold + 1 || numericish || digitDateShape);
  const top = fetchTop
    ? await sql.all(`SELECT ${c} AS v, count(*) AS n FROM ${SRC} WHERE ${value} GROUP BY ${c} ORDER BY n DESC, v LIMIT ${TOP_VALUES}`)
    : [];

  const tokenRows = await sql.all(
    `SELECT ${c} AS v, count(*) AS n FROM ${SRC} WHERE ${c} IN (${litList(naTokens)}) GROUP BY ${c}`,
  );
  const tokenCounts: Record<string, number> = {};
  for (const r of tokenRows) tokenCounts[String(r.v)] = toNumber(r.n);

  const unparsedTop =
    toNumber(agg.unparsed_count) > 0 && fetchTop
      ? await sql.all(
          `SELECT ${c} AS v, count(*) AS n FROM ${SRC}
           WHERE ${value} AND NOT (${finite(c)} OR regexp_matches(${c}, ${RE.thousands}))
           GROUP BY ${c} ORDER BY n DESC, v LIMIT 6`,
        )
      : [];

  return {
    name,
    rowCount,
    nullCount: toNumber(agg.null_count),
    tokenCounts,
    distinct: toNumber(agg.distinct_count),
    valueCount: toNumber(agg.value_count),
    topValues: top.map((r) => ({ value: String(r.v), count: toNumber(r.n) })),
    shapes: shapeRows.map((r) => ({ shape: String(r.shape), count: toNumber(r.n) })),
    runShapes: runRows.map((r) => ({ shape: String(r.shape), count: toNumber(r.n) })),
    shapeSample: toNumber(sample.n),
    intCount: toNumber(agg.int_count),
    floatCount: toNumber(agg.float_count),
    thousandsCount: toNumber(agg.thousands_count),
    plainBigCount: toNumber(agg.plain_big_count),
    leadingZeroCount: toNumber(agg.leading_zero_count),
    sciCount: toNumber(agg.sci_count),
    unparsedCount: toNumber(agg.unparsed_count),
    unparsedTop: unparsedTop.map((r) => ({ value: String(r.v), count: toNumber(r.n) })),
    unparsedDistinct: toNumber(agg.unparsed_distinct),
    negativeCount: toNumber(agg.negative_count),
    p99: toNumberOrNull(agg.p99),
    minLength: toNumber(agg.min_len),
    maxLength: toNumber(agg.max_len),
    meanLength: toNumber(agg.mean_len),
    spaceCount: toNumber(agg.space_count),
    lineBreakCount: toNumber(agg.line_break_count),
  };
}
