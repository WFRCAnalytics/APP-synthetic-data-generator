// Loading one worksheet into the all-text `src` table (specs/003 research R3, R4). The Excel
// extension reads the sheet with types (dates as DATE, numbers as DOUBLE, blank cells as NULL, empty
// text as ''), and each column is turned into the text a CSV would have had, so profiling, review and
// generation are exactly those of a CSV. Dates become ISO text, whole numbers lose their ".0", booleans
// become TRUE and FALSE, and a cell holding empty text becomes the empty-text token so it is counted
// apart from a blank cell. No statement here returns a cell to the caller: only names, types and a count.

import { AppError, sanitizeError } from "../../lib/errors";
import { EMPTY_TEXT_TOKEN } from "../../lib/spec/types";
import { describeFormat } from "../../lib/xlsx/formats";
import type { LoadResult } from "./load";
import { ident, lit, SRC, toNumber, type SqlRunner } from "./sql";

export interface SheetLoadOptions {
  sheet: string;
  /** Cell range of the table from the header row (A3:I203); absent reads from A1. */
  range?: string;
  header: boolean;
  /** One format code per column; used only if the sheet has to be read as text (see `loadSheet`). */
  formats?: readonly string[];
  /** The workbook's date system, needed to turn date serial numbers into dates when reading as text. */
  date1904?: boolean;
}

/** The `read_xlsx(...)` call for a registered workbook. */
export function buildReadSql(virtualName: string, options: SheetLoadOptions, allText = false): string {
  const parts = [lit(virtualName), `sheet = ${lit(options.sheet)}`];
  if (options.range) parts.push(`range = ${lit(options.range)}`);
  parts.push(`header = ${options.header}`);
  if (allText) parts.push("all_varchar = true");
  return `read_xlsx(${parts.join(", ")})`;
}

export interface ColumnType {
  name: string;
  type: string;
}

const EMPTY_TOKEN_SQL = `chr(${EMPTY_TEXT_TOKEN.charCodeAt(0)})`;

/** The text of one typed column: what the same cell would read as in a CSV. */
function textOf(column: ColumnType): string {
  const c = ident(column.name);
  const type = column.type.toUpperCase();
  if (type === "VARCHAR") return `CASE WHEN ${c} = '' THEN ${EMPTY_TOKEN_SQL} ELSE ${c} END AS ${c}`;
  if (type === "BOOLEAN") return `CASE WHEN ${c} IS NULL THEN NULL WHEN ${c} THEN 'TRUE' ELSE 'FALSE' END AS ${c}`;
  if (type === "TIMESTAMP" || type.startsWith("TIMESTAMP ")) return `strftime(${c}, '%Y-%m-%d %H:%M:%S') AS ${c}`;
  if (type === "DOUBLE" || type === "FLOAT" || type === "REAL" || type.startsWith("DECIMAL")) {
    // A whole number reads as 1000, not 1000.0; anything else keeps its shortest exact text.
    return `CASE WHEN ${c} IS NULL THEN NULL WHEN isfinite(${c}) AND ${c} = floor(${c}) AND abs(${c}) < 1e15 THEN CAST(CAST(${c} AS BIGINT) AS VARCHAR) ELSE CAST(${c} AS VARCHAR) END AS ${c}`;
  }
  return `CAST(${c} AS VARCHAR) AS ${c}`; // DATE, TIME, integers and anything else
}

/**
 * The SELECT list for a sheet read as text (`all_varchar`), used when a column mixes kinds (a totals row of
 * text under numbers, a date among numbers). Values come back as the cell's own text: numbers as "2000.0",
 * dates as serial numbers. Whole numbers lose the ".0", empty text becomes the token, and a column whose
 * format code is a date or time has its serial numbers turned into ISO text (where the value is a number;
 * anything else stays as it is).
 */
export function buildFallbackConversionSql(columns: readonly ColumnType[], formats: readonly string[], date1904: boolean): string {
  return columns
    .map((column, i) => {
      const c = ident(column.name);
      const kind = describeFormat(formats[i] ?? "General").kind;
      const epoch = date1904 ? "TIMESTAMP '1904-01-01 00:00:00'" : "TIMESTAMP '1899-12-30 00:00:00'";
      const at = `${epoch} + to_seconds(CAST(round(CAST(${c} AS DOUBLE) * 86400) AS BIGINT))`;
      const numeric = `try_cast(${c} AS DOUBLE) IS NOT NULL`;
      if (kind === "date") return `CASE WHEN ${numeric} THEN strftime(${at}, '%Y-%m-%d') ELSE ${c} END AS ${c}`;
      if (kind === "datetime") return `CASE WHEN ${numeric} THEN strftime(${at}, '%Y-%m-%d %H:%M:%S') ELSE ${c} END AS ${c}`;
      if (kind === "time") return `CASE WHEN ${numeric} THEN strftime(TIMESTAMP '1970-01-01 00:00:00' + to_seconds(CAST(round(CAST(${c} AS DOUBLE) * 86400) AS BIGINT)), '%H:%M:%S') ELSE ${c} END AS ${c}`;
      return `CASE WHEN ${c} = '' THEN ${EMPTY_TOKEN_SQL} ELSE regexp_replace(${c}, ${String.raw`'^(-?[0-9]+)\.0$'`}, ${String.raw`'\1'`}) END AS ${c}`;
    })
    .join(", ");
}

/** The SELECT list that turns the typed columns of a sheet into text, keeping names and order. */
export function buildConversionSql(columns: readonly ColumnType[]): string {
  return columns.map(textOf).join(", ");
}

/** Whether an engine failure is a cell that did not fit its column's type (the engine decided the type from the first rows). */
const isTypeMismatch = (err: unknown): boolean => /failed to parse cell|could not convert|conversion error/i.test(err instanceof Error ? err.message : String(err));

/**
 * Creates the `src` table from a registered workbook (the Excel extension must already be loaded). The
 * sheet is read with types. If a column mixes kinds further down than the engine looked (text in a
 * numeric column, such as a totals row), it is read again as text, with date serial numbers converted
 * using the column formats; the columns that mix are reported so the user can be told.
 */
export async function loadSheet(sql: SqlRunner, virtualName: string, options: SheetLoadOptions): Promise<LoadResult> {
  const read = buildReadSql(virtualName, options);
  try {
    const described = await sql.all(`DESCRIBE SELECT * FROM ${read}`);
    const columns: ColumnType[] = described.map((r) => ({ name: String(r.column_name), type: String(r.column_type) }));
    if (columns.length === 0) throw new AppError("file_empty");
    const types = columns.map((c) => c.type.toUpperCase());
    const names = columns.map((c) => c.name);

    try {
      await sql.run(`CREATE OR REPLACE TABLE ${SRC} AS SELECT ${buildConversionSql(columns)} FROM ${read}`);
    } catch (err) {
      if (!isTypeMismatch(err)) throw err;
      const text = buildReadSql(virtualName, options, true);
      await sql.run(`CREATE OR REPLACE TABLE ${SRC} AS SELECT ${buildFallbackConversionSql(columns, options.formats ?? [], options.date1904 ?? false)} FROM ${text}`);
      // Which columns mix: those the engine took for numbers or dates but that hold something else too (counts only).
      const checks = columns
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.type.toUpperCase() !== "VARCHAR");
      const mixed: string[] = [];
      if (checks.length > 0) {
        const [counts] = await sql.all(`SELECT ${checks.map(({ c, i }) => `count(*) FILTER (WHERE ${ident(c.name)} IS NOT NULL AND try_cast(${ident(c.name)} AS DOUBLE) IS NULL AND NOT (${ident(c.name)} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}( [0-9:]+)?$' OR ${ident(c.name)} ~ '^[0-9]{2}:[0-9]{2}:[0-9]{2}$')) AS m${i}`).join(", ")} FROM ${SRC}`);
        for (const { c, i } of checks) if (toNumber(counts[`m${i}`]) > 0) mixed.push(c.name);
      }
      const [row] = await sql.all(`SELECT count(*) AS n FROM ${SRC}`);
      return { rowCount: toNumber(row.n), columnNames: names, columnTypes: types, mixedColumns: mixed };
    }

    const [row] = await sql.all(`SELECT count(*) AS n FROM ${SRC}`);
    return { rowCount: toNumber(row.n), columnNames: names, columnTypes: types };
  } catch (err) {
    throw sanitizeError(err); // engine messages quote cell values; never pass them on
  }
}
