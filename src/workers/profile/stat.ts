// Loading an SPSS or Stata file into the all-text `src` table (specs/017). DuckDB's stats_duck extension (its read_stat function) reads the file
// with types; a whole number reads as 1000, not 1000.0, dates as ISO text, missing values as NULL, exactly as a worksheet
// does. Value labels and variable labels are not read. Messages from the engine are never passed on.

import { AppError } from "../../lib/errors";
import { workbookTooLarge } from "../../features/ingest/sizeWarnings";
import type { LoadResult } from "./load";
import { ident, lit, SRC, toNumber, type SqlRunner } from "./sql";
import { buildConversionSql, type ColumnType } from "./xlsx";

export interface StatInfo {
  rowCount: number;
  columns: ColumnType[];
  /** An estimate of the data once opened, from the counts (never a value). */
  expandedBytes: number;
}

export const readSql = (virtualName: string): string => `read_stat(${lit(virtualName)})`;

export async function inspectStat(sql: SqlRunner, virtualName: string): Promise<StatInfo> {
  try {
    const described = await sql.all(`DESCRIBE SELECT * FROM ${readSql(virtualName)}`);
    const columns: ColumnType[] = described.map((r) => ({
      name: String(r.column_name),
      type: String(r.column_type),
    }));
    const [counts] = await sql.all(`SELECT count(*) AS n FROM ${readSql(virtualName)}`);
    const rowCount = toNumber(counts.n);
    if (rowCount === 0 || columns.length === 0) throw new AppError("stat_empty");
    const info = { rowCount, columns, expandedBytes: rowCount * columns.length * 12 };
    if (workbookTooLarge(info.expandedBytes)) throw new AppError("stat_too_large");
    return info;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("stat_damaged"); // the engine's text can quote the file, so it is never shown
  }
}

export async function loadStat(
  sql: SqlRunner,
  virtualName: string,
  info: StatInfo,
): Promise<LoadResult> {
  try {
    await sql.run(
      `CREATE OR REPLACE TABLE ${SRC} AS SELECT ${buildConversionSql(info.columns)} FROM ${readSql(virtualName)}`,
    );
    const [row] = await sql.all(`SELECT count(*) AS n FROM ${SRC}`);
    return { rowCount: toNumber(row.n), columnNames: info.columns.map((c) => c.name) };
  } catch {
    throw new AppError("stat_damaged");
  }
}

export { ident };
