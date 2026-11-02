// Checks a built release zip (specs/004 FR-004, FR-005, FR-013, R8). It checks what ships, not dist/:
// the file set is exactly the contract, every file matches CHECKSUMS.sha256, the versions agree, the page
// keeps its content policy, no text file names an outside address that is not on the allowlist, and
// nothing looks like a secret. Binary files are not scanned for addresses; the offline end-to-end test
// (every request that is not to the launcher fails) is the proof that nothing is requested.
//
//   node scripts/verify-release.mjs [path/to/zip]     (default: the zip in release-out/)

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseChecksums, sha256Hex, stem } from "./release-lib.mjs";
import { readZip } from "./zip-reader.mjs";

export const SITE = "site/APP-synthetic-data-generator";

const TOP_FILES = ["README.txt", "CHECKSUMS.sha256", "LICENSES.md", "start.cmd", "start.ps1", "start.sh"];

/** Paths a release must hold, relative to its top folder (`*` stands for one folder name). */
export const REQUIRED_FILES = [
  ...TOP_FILES,
  `${SITE}/index.html`,
  `${SITE}/guard.js`,
  `${SITE}/duckdb/duckdb-eh.wasm`,
  `${SITE}/duckdb/duckdb-mvp.wasm`,
  `${SITE}/duckdb/duckdb-browser-eh.worker.js`,
  `${SITE}/duckdb/duckdb-browser-mvp.worker.js`,
  `${SITE}/duckdb-ext/VERSION.json`,
  `${SITE}/duckdb-ext/*/wasm_eh/excel.duckdb_extension.wasm`,
  `${SITE}/duckdb-ext/*/wasm_mvp/excel.duckdb_extension.wasm`,
  `${SITE}/duckdb-ext/*/wasm_eh/parquet.duckdb_extension.wasm`,
  `${SITE}/duckdb-ext/*/wasm_mvp/parquet.duckdb_extension.wasm`,
  `${SITE}/duckdb-ext/*/wasm_eh/json.duckdb_extension.wasm`,
  `${SITE}/duckdb-ext/*/wasm_mvp/json.duckdb_extension.wasm`,
  `${SITE}/duckdb-ext/*/wasm_eh/stats_duck.duckdb_extension.wasm`,
  `${SITE}/duckdb-ext/*/wasm_mvp/stats_duck.duckdb_extension.wasm`,
];

const FORBIDDEN = [/\.map$/, /(^|\/)\.env/, /(^|\/)node_modules\//, /(^|\/)(tests?|fixtures|test-results|\.fixtures)\//, /(^|\/)spike\.html$/, /\.(pem|key)$/];
const ADDRESS_FILES = /\.(js|mjs|html|css|json|txt|svg)$/;
const TEXT_FILES = /\.(js|mjs|html|css|json|txt|svg|md|cmd|ps1|sh)$|(^|\/)README\.txt$/;
const SECRETS = [
  [/ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,}/, "an access token"],
  [/AKIA[0-9A-Z]{16}/, "an access key"],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, "an access token"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
];
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

const text = (bytes) => new TextDecoder().decode(bytes);

/**
 * @param {{ zipName: string, bytes: Uint8Array, allowlist: { hosts: { host: string }[] } }} options
 * @returns {string[]} every problem found; empty when the release is good
 */
export function verifyRelease({ zipName, bytes, allowlist }) {
  const problems = [];
  const named = /^synthetic-data-generator-(\d+\.\d+\.\d+)-spec(\d+)-offline\.zip$/.exec(zipName);
  if (!named) problems.push(`The zip name ${zipName} is not synthetic-data-generator-<app version>-spec<N>-offline.zip.`);
  const app = named?.[1];
  const spec = named ? Number(named[2]) : undefined;

  let entries;
  try {
    entries = readZip(bytes).filter((e) => !e.name.endsWith("/"));
  } catch (err) {
    return [...problems, `The zip cannot be read: ${err instanceof Error ? err.message : String(err)}`];
  }

  const top = named ? stem(app, spec) : entries[0]?.name.split("/")[0];
  const files = new Map();
  for (const entry of entries) {
    if (!entry.name.startsWith(`${top}/`)) {
      problems.push(`${entry.name} is not inside the folder ${top}/ (the folder must be named like the zip).`);
      continue;
    }
    files.set(entry.name.slice(top.length + 1), entry.data);
  }

  // Only the contract's files, nothing that does not belong.
  for (const rel of files.keys()) {
    const belongs = TOP_FILES.includes(rel) || rel.startsWith(`${SITE}/`);
    if (!belongs || FORBIDDEN.some((re) => re.test(rel))) problems.push(`${rel} is not part of the release (a file that does not belong).`);
  }

  // Everything needed offline.
  for (const required of REQUIRED_FILES) {
    const present = required.includes("*")
      ? [...files.keys()].some((rel) => new RegExp(`^${required.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]+")}$`).test(rel))
      : files.has(required);
    if (!present) problems.push(`${required} is missing.`);
  }

  // The checksum list names every file except itself, and each one matches.
  const listText = files.get("CHECKSUMS.sha256");
  if (!listText) problems.push("CHECKSUMS.sha256 is missing.");
  else {
    try {
      const listed = new Map(parseChecksums(text(listText)).map((e) => [e.path, e.sha256]));
      for (const [rel, data] of files) {
        if (rel === "CHECKSUMS.sha256") continue;
        if (!listed.has(rel)) problems.push(`${rel} is not in CHECKSUMS.sha256.`);
        else if (listed.get(rel) !== sha256Hex(data)) problems.push(`${rel} does not match its checksum in CHECKSUMS.sha256.`);
      }
      for (const rel of listed.keys()) if (!files.has(rel)) problems.push(`CHECKSUMS.sha256 names ${rel}, which is not in the zip.`);
    } catch (err) {
      problems.push(`CHECKSUMS.sha256 cannot be read: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // The versions agree: zip name, README and the build in site/.
  const readme = files.get("README.txt");
  if (readme && named) {
    const m = /Version (\S+) \(writes spec file version (\d+)\)/.exec(text(readme));
    if (!m) problems.push("README.txt does not state the version as 'Version <app> (writes spec file version <N>)'.");
    else if (m[1] !== app || Number(m[2]) !== spec) problems.push(`README.txt says version ${m[1]} (spec ${m[2]}), but the zip is ${app} (spec ${spec}).`);
  }
  if (app) {
    const quoted = new RegExp(`["'\`]${app.replace(/\./g, "\\.")}["'\`]`);
    const carries = [...files].some(([rel, data]) => rel.startsWith(`${SITE}/assets/`) && rel.endsWith(".js") && quoted.test(text(data)));
    if (!carries) problems.push(`The build in site/ does not carry app version ${app}; it was built from another version.`);
  }

  // The page keeps its strict content policy.
  const index = files.get(`${SITE}/index.html`);
  if (index) {
    const meta = /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content=(["'])([\s\S]*?)\1/i.exec(text(index));
    if (!meta) problems.push(`${SITE}/index.html has no Content-Security-Policy meta tag (the content policy).`);
    else if (!/(^|;)\s*connect-src 'self'\s*(;|$)/.test(meta[2])) problems.push(`${SITE}/index.html: connect-src is not 'self', so the page could connect outside.`);
  }

  // Outside addresses in text the browser or the launcher reads, and anything that looks like a secret.
  const allowed = new Set([...allowlist.hosts.map((h) => h.host.toLowerCase()), ...LOCAL_HOSTS]);
  for (const [rel, data] of files) {
    const scanAddresses = (rel.startsWith(`${SITE}/`) && ADDRESS_FILES.test(rel)) || /^start\./.test(rel);
    if (!scanAddresses && !TEXT_FILES.test(rel)) continue;
    const body = text(data);
    if (scanAddresses) {
      const found = new Set();
      for (const m of body.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) found.add(m[1].replace(/\.+$/, "").toLowerCase());
      for (const host of found) if (!allowed.has(host)) problems.push(`${rel} names the outside address ${host}, which is not on the allowlist (scripts/release-allowlist.json).`);
    }
    for (const [pattern, label] of SECRETS) if (pattern.test(body)) problems.push(`${rel} looks like it holds ${label}; a secret must never ship.`);
  }

  return problems;
}

// Command line.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const out = join(root, "release-out");
  let zipPath = process.argv[2];
  if (!zipPath && existsSync(out)) {
    const found = readdirSync(out).find((f) => f.endsWith("-offline.zip"));
    if (found) zipPath = join(out, found);
  }
  if (!zipPath || !existsSync(zipPath)) {
    console.error("verify-release: no zip given and none in release-out/. Run `npm run release` first.");
    process.exit(1);
  }
  const allowlist = JSON.parse(readFileSync(join(root, "scripts", "release-allowlist.json"), "utf8"));
  const bytes = new Uint8Array(readFileSync(zipPath));
  const problems = verifyRelease({ zipName: basename(zipPath), bytes, allowlist });

  // The checksum file published beside the zip must be the one inside it.
  const beside = join(dirname(zipPath), "CHECKSUMS.sha256");
  if (problems.length === 0 && existsSync(beside)) {
    const inside = readZip(bytes).find((e) => e.name.endsWith("/CHECKSUMS.sha256"));
    if (inside && text(inside.data) !== readFileSync(beside, "utf8")) problems.push("release-out/CHECKSUMS.sha256 is not the same as the one inside the zip.");
  }

  if (problems.length > 0) {
    console.error(`verify-release: ${basename(zipPath)} has ${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`verify-release: ${basename(zipPath)} is good (${readZip(bytes).length} files).`);
}
