// The pure parts of building a release (specs/004): names from the two versions, the checksum list,
// the tag check and collecting files in a fixed order. Used by build-release, verify-release and
// check-tag, and tested in tests/unit/release-lib.test.ts.

import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";

/** The folder and file stem of a release, from the app version and the spec file version it writes. */
export const stem = (app, spec) => `synthetic-data-generator-${app}-spec${spec}-offline`;

export const zipName = (app, spec) => `${stem(app, spec)}.zip`;

/** The name of the GitHub Release. */
export const releaseName = (app, spec) => `v${app} (writes spec v${spec})`;

export const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** One line per file, sorted by path: `<sha256>  <path>`, LF endings, a final newline. */
export function formatChecksums(entries) {
  return [...entries].sort(byPath).map((e) => `${e.sha256}  ${e.path}\n`).join("");
}

/** Reads what `formatChecksums` writes; a line that does not fit throws with its number. */
export function parseChecksums(text) {
  const entries = [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  lines.forEach((line, i) => {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!m) throw new Error(`CHECKSUMS.sha256 line ${i + 1} is not "<sha256>  <path>"`);
    entries.push({ path: m[2], sha256: m[1] });
  });
  return entries;
}

/**
 * Whether a git tag is the release of this version: `v<version>`. A dry run also accepts a
 * pre-release of the version (`v0.2.0-rc1`), so the workflow can be tried without a real release.
 */
export function checkTag(tag, version, { dryRun = false } = {}) {
  const exact = `v${version}`;
  if (tag === exact) return { ok: true };
  if (dryRun && tag.startsWith(`${exact}-`) && tag.length > exact.length + 1) return { ok: true };
  return { ok: false, reason: `The tag ${tag} does not match package.json version ${version}; expected ${exact}${dryRun ? ` or ${exact}-<pre-release>` : ""}.` };
}

/**
 * Text files get the line endings their platform expects, so a Windows and a Linux checkout give the same
 * zip: scripts for Unix and notes in LF, Windows scripts and README.txt in CRLF, and index.html in LF (the
 * hosted build's own bytes, but ending in exactly one newline: the bundler leaves one or none by machine).
 */
export function normalizeLineEndings(name, bytes) {
  if (!/\.(sh|cmd|ps1|txt|md|html)$/.test(name)) return bytes;
  const text = new TextDecoder().decode(bytes).replace(/\r+\n/g, "\n"); // also a doubled CR, which a bundler can leave
  const crlf = /\.(cmd|ps1|txt)$/.test(name);
  // The page ends with exactly one newline (the bundler leaves it with or without one depending on the machine).
  const body = name.endsWith(".html") ? text.replace(/\s+$/, "") + "\n" : text;
  return new TextEncoder().encode(crlf ? body.replace(/\n/g, "\r\n") : body);
}

/** Every file under a folder as a path relative to it, forward slashes, sorted by path. */
export async function collectFiles(root) {
  const out = [];
  async function walk(dir, prefix) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel);
      else if (entry.isFile()) out.push(rel);
    }
  }
  await walk(root, "");
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Joins a relative path onto a folder and refuses a result outside it. */
export function safeJoin(root, rel) {
  const base = resolve(root);
  const target = resolve(base, rel);
  if (isAbsolute(rel) || !(target === base || target.startsWith(base + sep))) throw new Error(`Path ${rel} is outside ${root}`);
  return target;
}
