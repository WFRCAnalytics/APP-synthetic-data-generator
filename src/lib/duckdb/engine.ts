// Starts DuckDB-WASM from the binaries this app serves itself (public/duckdb/, copied from the npm
// package by scripts/copy-duckdb.mjs). Nothing is fetched from a CDN (constitution Principle I and
// III). Only the builds that run without cross-origin isolation are offered, because GitHub Pages
// cannot send the headers threads need.

import * as duckdb from "@duckdb/duckdb-wasm";

export interface Engine {
  db: duckdb.AsyncDuckDB;
  worker: Worker;
  /** Terminates the worker and frees all data held by DuckDB. */
  dispose: () => Promise<void>;
}

export function duckdbBundles(baseUrl: string): duckdb.DuckDBBundles {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return {
    mvp: {
      mainModule: `${base}duckdb-mvp.wasm`,
      mainWorker: `${base}duckdb-browser-mvp.worker.js`,
    },
    eh: {
      mainModule: `${base}duckdb-eh.wasm`,
      mainWorker: `${base}duckdb-browser-eh.worker.js`,
    },
  };
}

/** Creates an in-memory DuckDB instance. `baseUrl` is where the self-hosted binaries live. */
export async function createEngine(baseUrl: string): Promise<Engine> {
  const bundle = await duckdb.selectBundle(duckdbBundles(baseUrl));
  if (!bundle.mainWorker) throw new Error("no DuckDB worker bundle is available");

  const worker = new Worker(bundle.mainWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

  return {
    db,
    worker,
    dispose: async () => {
      await db.terminate();
      worker.terminate();
    },
  };
}

export { duckdb };
