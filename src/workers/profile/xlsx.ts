// Loading one worksheet into the all-text `src` table (specs/003 research R3, R4). The Excel
// extension reads the sheet with types (dates as DATE, numbers as DOUBLE, blank cells as NULL, empty
// text as ''), and each column is turned into the text a CSV would have had, so profiling, review and
// generation are exactly those of a CSV. Dates become ISO text, whole numbers lose their ".0", booleans
// become TRUE and FALSE, and a cell holding empty text becomes the empty-text token so it is counted
// apart from a blank cell. No statement here returns a cell to the caller: only names, types and a count.

import { AppError, sanitizeError } from "../../lib/errors";
import { EMPTY_TEXT_TOKEN } from "../../lib/spec/types";
import type { LoadResult } from "./load";
import { ident, lit, SRC, toNumber, type SqlRunner } from "./sql";

export interface SheetLoadOptions {
  sheet: string;
  /** Cell range of the table from the header row (A3:I203); absent reads from A1. */
  range?: string;
  header: boolean;
}

/** The `read_xlsx(...)` call for a registered workbook. */
export function buildReadSql(virtualName: string, options: SheetLoadOptions): string {
  const parts = [lit(virtualName), `sheet = ${lit(options.sheet)}`];
  if (options.range) parts.push(`range = ${lit(options.range)}`);
  parts.push(`header = ${options.header}`);
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

/** The SELECT list that turns the typed columns of a sheet into text, keeping names and order. */
export function buildConversionSql(columns: readonly ColumnType[]): string {
  return columns.map(textOf).join(", ");
}

/** Creates the `src` table from a registered workbook (the Excel extension must already be loaded). */
export async function loadSheet(sql: SqlRunner, virtualName: string, options: SheetLoadOptions): Promise<LoadResult> {
  const read = buildReadSql(virtualName, options);
  try {
    const described = await sql.all(`DESCRIBE SELECT * FROM ${read}`);
    const columns: ColumnType[] = described.map((r) => ({ name: String(r.column_name), type: String(r.column_type) }));
    if (columns.length === 0) throw new AppError("file_empty");
    await sql.run(`CREATE OR REPLACE TABLE ${SRC} AS SELECT ${buildConversionSql(columns)} FROM ${read}`);
    const [row] = await sql.all(`SELECT count(*) AS n FROM ${SRC}`);
    return { rowCount: toNumber(row.n), columnNames: columns.map((c) => c.name), columnTypes: columns.map((c) => c.type.toUpperCase()) };
  } catch (err) {
    throw sanitizeError(err); // engine messages quote cell values; never pass them on
  }
}
