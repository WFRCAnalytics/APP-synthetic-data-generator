// Wraps a DuckDB-WASM connection as the SqlRunner the profiling code expects.

import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { normalizeRow, type Row, type SqlRunner } from "./sql";

export function runnerFor(conn: AsyncDuckDBConnection): SqlRunner {
  return {
    async all(sql: string): Promise<Row[]> {
      const table = await conn.query(sql);
      return table.toArray().map((r) => normalizeRow(r.toJSON() as Row));
    },
    async run(sql: string): Promise<void> {
      await conn.query(sql);
    },
  };
}
