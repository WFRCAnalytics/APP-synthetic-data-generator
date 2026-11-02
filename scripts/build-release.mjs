// Builds the offline release zip from the build in dist/ (specs/004). The zip holds the unchanged site
// under site/APP-synthetic-data-generator/ (the same path the hosted site uses, so the same files work),
// the launcher, README.txt, LICENSES.md and CHECKSUMS.sha256. The build is reproducible: the same dist/
// and the same commit give the same bytes. Run `npm run release` (builds dist/ first).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLicenses } from "./licenses.mjs";
import { collectFiles, formatChecksums, normalizeLineEndings, releaseName, safeJoin, sha256Hex, stem, zipName } from "./release-lib.mjs";
import { createZip } from "./zip-writer.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const out = join(root, "release-out");

if (!existsSync(join(dist, "index.html"))) {
  console.error("build-release: dist/ has no build. Run `npm run release` (it builds first), or `npm run build`.");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const specVersion = Number(/export const SPEC_VERSION = (\d+);/.exec(readFileSync(join(root, "src/lib/spec/types.ts"), "utf8"))?.[1]);
if (!Number.isInteger(specVersion)) {
  console.error("build-release: could not read SPEC_VERSION from src/lib/spec/types.ts");
  process.exit(1);
}

/** The time stamped on every file: SOURCE_DATE_EPOCH, else the commit's date, so the clock never matters. */
function buildTime() {
  if (process.env.SOURCE_DATE_EPOCH) return new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000);
  try {
    const seconds = execFileSync("git", ["log", "-1", "--format=%ct"], { cwd: root, encoding: "utf8" }).trim();
    if (/^\d+$/.test(seconds)) return new Date(Number(seconds) * 1000);
  } catch {
    // not a git checkout
  }
  return new Date("2026-01-01T00:00:00Z");
}

const mtime = buildTime();
const date = mtime.toISOString().slice(0, 10);
const top = stem(pkg.version, specVersion);

const files = [];
const add = (path, data, mode) => files.push({ path: `${top}/${path}`, data, ...(mode ? { mode } : {}) });

// The site: dist/ unchanged.
// sw.js keeps an offline copy for the hosted page; a copy that runs from a folder needs none, so it is not part of the zip.
for (const rel of (await collectFiles(dist)).filter((r) => r !== "sw.js")) add(`site/APP-synthetic-data-generator/${rel}`, normalizeLineEndings(rel, new Uint8Array(readFileSync(safeJoin(dist, rel)))));

// The launcher.
const launcherDir = join(root, "release", "launcher");
for (const name of ["start.cmd", "start.ps1", "start.sh"]) {
  add(name, normalizeLineEndings(name, new Uint8Array(readFileSync(join(launcherDir, name)))), name.endsWith(".sh") ? 0o755 : undefined);
}

// README and licences.
const readme = readFileSync(join(root, "release", "README.template.txt"), "utf8")
  .replaceAll("{{APP_VERSION}}", pkg.version)
  .replaceAll("{{SPEC_VERSION}}", String(specVersion))
  .replaceAll("{{DATE}}", date);
if (/\{\{[A-Z_]+\}\}/.test(readme)) {
  console.error("build-release: README.template.txt has a placeholder that was not filled.");
  process.exit(1);
}
add("README.txt", normalizeLineEndings("README.txt", new TextEncoder().encode(readme)));
add("LICENSES.md", normalizeLineEndings("LICENSES.md", new TextEncoder().encode(buildLicenses(root))));

// The checksum list covers every file except itself, and goes in last.
const checksums = formatChecksums(files.map((f) => ({ path: f.path.slice(top.length + 1), sha256: sha256Hex(f.data) })));
add("CHECKSUMS.sha256", new TextEncoder().encode(checksums));

mkdirSync(out, { recursive: true });
// release-out/ holds the current release only, so tools that look for "the zip" cannot pick an older one.
for (const old of readdirSync(out)) if (old.endsWith("-offline.zip")) rmSync(join(out, old));
const zipPath = join(out, zipName(pkg.version, specVersion));
writeFileSync(zipPath, createZip(files, { mtime }));
writeFileSync(join(out, "CHECKSUMS.sha256"), checksums);
writeFileSync(join(out, "release.json"), JSON.stringify({ name: releaseName(pkg.version, specVersion), appVersion: pkg.version, specVersion, zip: zipName(pkg.version, specVersion), files: files.length, date }, null, 2) + "\n");

console.log(`build-release: ${zipPath}`);
console.log(`  ${releaseName(pkg.version, specVersion)}, ${files.length} files, built ${date}`);
