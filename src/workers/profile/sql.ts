// Small helpers shared by the profiling SQL. The same code runs in the browser worker (against
// AsyncDuckDB) and in Node tests (against DuckDB's blocking bindings), so it talks to an abstract
// runner instead of a concrete connection.

export type Row = Record<string, unknown>;

export interface SqlRunner {
  /** Runs a query and returns its rows with numbers, bigints and lists already normalized. */
  all(sql: string): Promise<Row[]>;
  /** Runs a statement that returns no rows. */
  run(sql: string): Promise<void>;
}

/** Name of the table holding the loaded file, and of its random sample used for type detection. */
export const SRC = "src";
export const SMP = "smp";

/** Quotes an identifier (a column name) for SQL. */
export const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** Quotes a string literal for SQL. */
export const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** A SQL list of string literals: 'a', 'b'. Never empty (an empty IN list is a syntax error). */
export function litList(values: readonly string[]): string {
  return values.length === 0 ? "NULL" : values.map(lit).join(", ");
}

/** Converts a DuckDB result cell to a plain number (BIGINT arrives as bigint). */
export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return NaN;
}

/** Like toNumber, but null and NaN become null. */
export function toNumberOrNull(value: unknown): number | null {
  const n = toNumber(value);
  return Number.isFinite(n) ? n : null;
}

/** Converts a DuckDB list result (an Arrow vector or an array) to a plain number array. */
export function toNumberArray(value: unknown): number[] {
  if (value === null || value === undefined) return [];
  const source =
    typeof (value as { toArray?: unknown }).toArray === "function"
      ? (value as { toArray(): ArrayLike<unknown> }).toArray()
      : (value as ArrayLike<unknown>);
  return Array.from(source as ArrayLike<unknown>, toNumber);
}

/** Normalizes one result row: bigint to number, Arrow vectors to arrays. */
export function normalizeRow(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "bigint") out[key] = Number(value);
    else if (value !== null && typeof value === "object" && typeof (value as { toArray?: unknown }).toArray === "function") {
      out[key] = toNumberArray(value);
    } else out[key] = value;
  }
  return out;
}

/** 0, 0.01, ... 1 as a SQL list, for quantile_cont (101 percentiles). */
export const QUANTILE_LIST = `[${Array.from({ length: 101 }, (_, i) => (i / 100).toString()).join(", ")}]`;

/** SQL expression turning a value into its character shape: digits to 9, letters to A. */
export const shapeOf = (col: string): string =>
  `regexp_replace(regexp_replace(left(${col}, 64), '[0-9]', '9', 'g'), '[A-Za-z]', 'A', 'g')`;
