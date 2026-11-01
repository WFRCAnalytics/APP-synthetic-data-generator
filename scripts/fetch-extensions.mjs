// Fetches the DuckDB extensions the app needs (today: excel and parquet) from the official host into
// public/duckdb-ext/, so the site serves them itself (constitution Principle I and III: nothing is
// fetched from outside at run time; this build step is the only moment anything is).
//
// The engine version is asked from the pinned DuckDB-WASM, so moving the dependency to a new version
// picks the matching extension files by itself. Files are checked (size, WebAssembly magic bytes) and
// recorded with their sha-256 sums in public/duckdb-ext/VERSION.json; a run that finds the right files
// already in place downloads nothing. Run automatically before dev and build.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "duckdb-ext");
const HOST = process.env.DUCKDB_EXTENSION_HOST ?? "https://extensions.duckdb.org";
const EXTENSIONS = ["excel", "parquet"];
const PLATFORMS = ["wasm_eh", "wasm_mvp"]; // the two builds copied by copy-duckdb.mjs
const MIN_BYTES = 50_000;

const require = createRequire(import.meta.url);

/** The DuckDB engine version inside the pinned DuckDB-WASM, such as "v1.5.4". */
async function engineVersion() {
  const duckdb = require("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs");
  const dist = dirname(require.resolve("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs"));
  const bundles = {
    mvp: { mainModule: join(dist, "duckdb-mvp.wasm"), mainWorker: join(dist, "duckdb-node-mvp.worker.cjs") },
    eh: { mainModule: join(dist, "duckdb-eh.wasm"), mainWorker: join(dist, "duckdb-node-eh.worker.cjs") },
  };
  const db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate(() => {});
  const conn = db.connect();
  const version = String(conn.query("SELECT version() AS v").toArray()[0].toJSON().v);
  conn.close();
  return version.startsWith("v") ? version : `v${version}`;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isWasm = (b) => b.length > 8 && b[0] === 0x00 && b[1] === 0x61 && b[2] === 0x73 && b[3] === 0x6d;

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < MIN_BYTES || !isWasm(bytes)) throw new Error(`${url}: not a WebAssembly extension (${bytes.length} bytes)`);
  return bytes;
}

const version = await engineVersion();
const versionFile = join(outDir, "VERSION.json");
const previous = existsSync(versionFile) ? JSON.parse(readFileSync(versionFile, "utf8")) : null;
const files = {};
let fetched = 0;

for (const ext of EXTENSIONS) {
  for (const platform of PLATFORMS) {
    const rel = `${version}/${platform}/${ext}.duckdb_extension.wasm`;
    const path = join(outDir, rel);
    const known = previous?.engine === version ? previous.files?.[rel] : undefined;
    if (known && existsSync(path) && sha256(readFileSync(path)) === known) {
      files[rel] = known;
      continue;
    }
    const bytes = await download(`${HOST}/${rel}`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    files[rel] = sha256(bytes);
    fetched++;
  }
}

mkdirSync(outDir, { recursive: true });
writeFileSync(versionFile, JSON.stringify({ engine: version, host: HOST, files }, null, 2));
console.log(`fetch-extensions: engine ${version}, ${Object.keys(files).length} extension files in public/duckdb-ext/ (${fetched} downloaded)`);
