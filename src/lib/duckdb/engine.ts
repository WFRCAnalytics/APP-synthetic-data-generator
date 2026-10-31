// Starts DuckDB-WASM from the binaries this app serves itself (public/duckdb/, copied from the npm
// package by scripts/copy-duckdb.mjs). Nothing is fetched from a CDN (constitution Principle I and
// III). Only the builds that run without cross-origin isolation are offered, because GitHub Pages
// cannot send the headers threads need.

import * as duckdb from "@duckdb/duckdb-wasm";
import { NET_CHANNEL } from "../netChannel";
import { patchedWorkerSource } from "../../workers/netpatch";

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

const START_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number, worker: Worker): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("The data engine did not start in time."));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Creates an in-memory DuckDB instance. `baseUrl` is where the self-hosted binaries live. */
export async function createEngine(baseUrl: string): Promise<Engine> {
  const bundle = await duckdb.selectBundle(duckdbBundles(baseUrl));
  if (!bundle.mainWorker) throw new Error("no DuckDB worker bundle is available");

  // DuckDB downloads its WebAssembly module from inside its own worker, so that worker is started
  // through a small wrapper that reports its requests to the page's counter.
  const absolute = new URL(bundle.mainWorker, self.location.href).href;
  const source = patchedWorkerSource(absolute, NET_CHANNEL, self.location.origin);
  const wrapperUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const worker = new Worker(wrapperUrl);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger() /* the engine's own messages quote cell values; none may reach the console */, worker);
  // The module is fetched from inside a blob worker, which has no base to resolve a relative path
  // against, so it needs an absolute URL.
  const moduleUrl = new URL(bundle.mainModule, self.location.href).href;
  // A worker that fails to start can leave instantiate waiting forever; fail loudly instead.
  await withTimeout(db.instantiate(moduleUrl, bundle.pthreadWorker), START_TIMEOUT_MS, worker);
  URL.revokeObjectURL(wrapperUrl); // the worker has started; the wrapper is no longer needed

  return {
    db,
    worker,
    dispose: async () => {
      await db.terminate();
      worker.terminate();
    },
  };
}

export { loadExcelExtension } from "./extension";
export { duckdb };
