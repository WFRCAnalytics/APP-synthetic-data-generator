// Loads the CSV into an in-memory all-text table (research.md R1). Every option is passed
// explicitly, with auto-detection off: the dialect came from our own sniffer, so DuckDB reads
// exactly what the export will later write, and a malformed file fails loudly instead of being
// guessed at (DuckDB's sniffer silently misread our ragged fixture). Line endings need no option:
// DuckDB reads LF, CRLF and CR-only files with auto-detect off (its new_line option rejects them).

import { AppError, sanitizeError } from "../../lib/errors";
import type { FileSettings } from "../../lib/profile/types";
import { ident, lit, SRC, toNumber, type SqlRunner } from "./sql";

export interface LoadResult {
  rowCount: number;
  columnNames: string[];
  /** For a workbook: the engine's type of each column as read (VARCHAR for text cells, DOUBLE for numbers). Never a value. */
  columnTypes?: string[];
}


/**
 * Creates the `src` table from a registered file. `readEncoding` is what DuckDB itself must read:
 * UTF-8 for files we have already transcoded, UTF-16 (little endian) for native UTF-16.
 */
export async function loadCsv(
  sql: SqlRunner,
  virtualName: string,
  settings: FileSettings,
  columnNames: readonly string[],
  readEncoding: "utf-8" | "utf-16" = "utf-8",
): Promise<LoadResult> {
  if (columnNames.length === 0) throw new AppError("file_empty");

  const columns = columnNames.map((n) => `${lit(n)}: 'VARCHAR'`).join(", ");
  const quote = settings.quote ?? "";
  const options = [
    "auto_detect = false",
    `header = ${settings.header}`,
    `delim = ${lit(settings.delimiter)}`,
    `quote = ${lit(quote)}`,
    `escape = ${lit(quote)}`,
    `columns = {${columns}}`,
    "null_padding = false",
    "ignore_errors = false",
    ...(readEncoding === "utf-16" ? ["encoding = 'utf-16'"] : []),
  ].join(", ");

  try {
    await sql.run(`CREATE OR REPLACE TABLE ${SRC} AS SELECT * FROM read_csv(${lit(virtualName)}, ${options})`);
    const [row] = await sql.all(`SELECT count(*) AS n FROM ${SRC}`);
    return { rowCount: toNumber(row.n), columnNames: [...columnNames] };
  } catch (err) {
    throw sanitizeError(err); // engine messages quote cell values; never pass them on
  }
}

/** The column names of the loaded table, in file order. */
export async function loadedColumns(sql: SqlRunner): Promise<string[]> {
  const rows = await sql.all(`SELECT name FROM pragma_table_info('${SRC}') ORDER BY cid`);
  return rows.map((r) => String(r.name));
}

export { ident };
