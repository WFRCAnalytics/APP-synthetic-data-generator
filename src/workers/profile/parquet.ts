// Loading a Parquet file into the all-text `src` table (specs/005 research R2, R5). Only structure is
// asked of the file: the column types, the schema, the row and row-group counts and the sizes. Nothing
// that can hold a real value is selected: not the creator text, not the key-value metadata, not any
// minimum, maximum or null count of a row group, not a bloom filter. The data goes into `src` as the text a
// CSV would have held (dates and timestamps as ISO text, decimals and 64-bit integers exact, booleans as
// TRUE and FALSE, empty text as the empty-text token, nulls as NULL), so profiling, review and
// generation are exactly those of a CSV. A column that is nested or of a kind that cannot be faked is not
// read at all: it loads as all-NULL and is marked unsupported.

import { AppError, sanitizeError } from "../../lib/errors";
import { mapColumn, topLevelRows, type SchemaRow } from "../../lib/parquet/schema";
import type { ParquetType, UnsupportedReason } from "../../lib/parquet/types";
import { EMPTY_TEXT_TOKEN } from "../../lib/spec/types";
import { workbookTooLarge } from "../../features/ingest/sizeWarnings";
import type { LoadResult } from "./load";
import { ident, lit, SRC, toNumber, type SqlRunner } from "./sql";

export interface ParquetColumnInfo {
  /** The name the engine gives the column (it numbers duplicates and names empty ones). */
  name: string;
  /** The engine's type text, such as SMALLINT or DECIMAL(10,2). */
  duckType: string;
  /** The type to write the column back with, or null when it is unsupported. */
  type: ParquetType | null;
  unsupported: UnsupportedReason | null;
  /** The file's own name was empty or repeated, so the reader gave the column another one. */
  renamed: boolean;
}

export interface ParquetInfo {
  rowCount: number;
  rowGroups: number;
  /** The size of the data once opened, from the footer's sizes (never a value). */
  expandedBytes: number;
  columns: ParquetColumnInfo[];
}

const EMPTY_TOKEN_SQL = `chr(${EMPTY_TEXT_TOKEN.charCodeAt(0)})`;

/** The `read_parquet(...)` call for a registered file. */
export const readSql = (virtualName: string): string => `read_parquet(${lit(virtualName)})`;

/** Whether an error from the engine means the file itself is the problem (not memory or a cancel). */
function asFileProblem(err: unknown): AppError {
  const safe = sanitizeError(err);
  return ["csv_parse_error", "conversion_error", "engine_error", "internal_error"].includes(safe.code) ? new AppError("parquet_damaged") : safe;
}

/** Structure of a registered Parquet file, read without touching a cell. */
export async function inspectParquet(sql: SqlRunner, virtualName: string): Promise<ParquetInfo> {
  try {
    const file = lit(virtualName);
    const described = await sql.all(`DESCRIBE SELECT * FROM ${readSql(virtualName)}`);
    const schema = (await sql.all(
      `SELECT name, type, converted_type, logical_type, type_length, scale, "precision", repetition_type, num_children FROM parquet_schema(${file})`,
    )) as unknown as SchemaRow[];
    const [counts] = await sql.all(`SELECT num_rows, num_row_groups FROM parquet_file_metadata(${file})`);
    const [sizes] = await sql.all(`SELECT CAST(coalesce(sum(total_uncompressed_size), 0) AS DOUBLE) AS bytes FROM parquet_metadata(${file})`);

    const top = topLevelRows(schema);
    const columns: ParquetColumnInfo[] = described.map((r, i) => {
      const duckType = String(r.column_type);
      const row = top[i];
      const name = String(r.column_name);
      if (!row) return { name, duckType, type: null, unsupported: "other", renamed: false };
      const renamed = row.name !== name;
      const mapped = mapColumn(duckType, row);
      return mapped.ok ? { name, duckType, type: mapped.type, unsupported: null, renamed } : { name, duckType, type: null, unsupported: mapped.reason, renamed };
    });

    const info: ParquetInfo = { rowCount: toNumber(counts.num_rows), rowGroups: toNumber(counts.num_row_groups), expandedBytes: toNumber(sizes.bytes), columns };
    if (info.rowCount === 0 || columns.length === 0) throw new AppError("parquet_empty");
    if (workbookTooLarge(info.expandedBytes)) throw new AppError("parquet_too_large");
    return info;
  } catch (err) {
    throw asFileProblem(err);
  }
}

/** The text one column becomes: what the same value would be in a CSV. */
function textOf(column: ParquetColumnInfo): string {
  const c = ident(column.name);
  if (!column.type) return `CAST(NULL AS VARCHAR) AS ${c}`; // never read
  switch (column.type.kind) {
    case "string":
      return `CASE WHEN CAST(${c} AS VARCHAR) = '' THEN ${EMPTY_TOKEN_SQL} ELSE CAST(${c} AS VARCHAR) END AS ${c}`;
    case "bool":
      return `CASE WHEN ${c} IS NULL THEN NULL WHEN ${c} THEN 'TRUE' ELSE 'FALSE' END AS ${c}`;
    case "float":
      // A whole number reads as 1000, not 1000.0; anything else keeps its shortest exact text; NaN and infinity are missing.
      return `CASE WHEN ${c} IS NULL OR NOT isfinite(${c}) THEN NULL WHEN ${c} = floor(${c}) AND abs(${c}) < 1e15 THEN CAST(CAST(${c} AS BIGINT) AS VARCHAR) ELSE CAST(${c} AS VARCHAR) END AS ${c}`;
    case "timestamp":
      // Whole seconds, in UTC: the date handling of profiling reads no fractions (specs/005 research R5).
      return `strftime(CAST(${c} AS TIMESTAMP), '%Y-%m-%d %H:%M:%S') AS ${c}`;
    case "time":
      return `substr(CAST(${c} AS VARCHAR), 1, 8) AS ${c}`;
    default:
      return `CAST(${c} AS VARCHAR) AS ${c}`; // integers, decimals, dates
  }
}

/** Creates the `src` table from a registered Parquet file. */
export async function loadParquet(sql: SqlRunner, virtualName: string, info: ParquetInfo): Promise<LoadResult> {
  try {
    const select = info.columns.map(textOf).join(", ");
    await sql.run(`CREATE OR REPLACE TABLE ${SRC} AS SELECT ${select} FROM ${readSql(virtualName)}`);
    const [row] = await sql.all(`SELECT count(*) AS n FROM ${SRC}`);
    return { rowCount: toNumber(row.n), columnNames: info.columns.map((c) => c.name), columnTypes: info.columns.map((c) => c.duckType.toUpperCase()) };
  } catch (err) {
    throw asFileProblem(err);
  }
}
