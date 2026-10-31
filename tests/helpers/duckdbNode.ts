// DuckDB-WASM running in Node (its blocking bindings), wrapped as the SqlRunner the profiling code
// expects, so integration tests exercise the real SQL without a browser.

import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { normalizeRow, type SqlRunner } from "../../src/workers/profile/sql";
import { detectFileSettings, HEAD_BYTES, TAIL_BYTES, detectQuotedColumns, type OpenResult } from "../../src/workers/profile/open";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const duckdb: any = require("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs");
const DIST = dirname(require.resolve("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs"));

export interface NodeDb {
  sql: SqlRunner;
  registerPath(name: string, path: string): void;
  registerBuffer(name: string, bytes: Uint8Array): void;
  close(): void;
}

export async function createNodeDb(): Promise<NodeDb> {
  const bundles = {
    mvp: { mainModule: join(DIST, "duckdb-mvp.wasm"), mainWorker: join(DIST, "duckdb-node-mvp.worker.cjs") },
    eh: { mainModule: join(DIST, "duckdb-eh.wasm"), mainWorker: join(DIST, "duckdb-node-eh.worker.cjs") },
  };
  const db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate(() => {});
  const conn = db.connect();

  const sql: SqlRunner = {
    async all(query) {
      return conn.query(query).toArray().map((r: { toJSON(): Record<string, unknown> }) => normalizeRow(r.toJSON()));
    },
    async run(query) {
      conn.query(query);
    },
  };

  return {
    sql,
    registerPath: (name, path) => db.registerFileURL(name, path, duckdb.DuckDBDataProtocol.NODE_FS, false),
    registerBuffer: (name, bytes) => db.registerFileBuffer(name, bytes),
    close: () => {
      conn.close();
    },
  };
}

/** Reads a file's head and tail from disk and detects its settings, as the worker does from a File. */
export function openFromDisk(path: string): OpenResult & { quoted: boolean[] } {
  const size = statSync(path).size;
  const all = new Uint8Array(readFileSync(path));
  const head = all.subarray(0, HEAD_BYTES);
  const tail = all.subarray(Math.max(0, size - TAIL_BYTES));
  return { ...detectFileSettings(head, tail, size), quoted: detectQuotedColumns(head, size) };
}
