// Copies the DuckDB-WASM binaries and workers from node_modules into public/duckdb/ so the app
// serves them itself (constitution Principle I and III: no CDN at runtime). The files ship inside
// the npm package, so this needs no network access. Run automatically before dev and build.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(root, "node_modules", "@duckdb", "duckdb-wasm");
const distDir = join(pkgDir, "dist");
const outDir = join(root, "public", "duckdb");

// Only the builds that run without cross-origin isolation (no threads), which GitHub Pages
// cannot provide: the exception-handling build and the baseline MVP build.
const FILES = [
  "duckdb-eh.wasm",
  "duckdb-mvp.wasm",
  "duckdb-browser-eh.worker.js",
  "duckdb-browser-mvp.worker.js",
];

if (!existsSync(distDir)) {
  console.error("copy-duckdb: @duckdb/duckdb-wasm is not installed. Run `npm install` first.");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
for (const file of FILES) {
  const from = join(distDir, file);
  if (!existsSync(from)) {
    console.error(`copy-duckdb: expected file is missing from the package: ${file}`);
    process.exit(1);
  }
  copyFileSync(from, join(outDir, file));
}

const { version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
writeFileSync(join(outDir, "VERSION.json"), JSON.stringify({ duckdbWasm: version, files: FILES }, null, 2));
console.log(`copy-duckdb: copied ${FILES.length} files for @duckdb/duckdb-wasm ${version} to public/duckdb/`);
