// @vitest-environment node
// The check on a built release zip (specs/004 FR-004, FR-005, FR-013, SC-004): the files are exactly the
// contract, every file matches its checksum, the versions agree, the page keeps its content policy, and
// no file names an outside address that is not on the list of inert strings.

import { describe, expect, it } from "vitest";
import allowlist from "../../scripts/release-allowlist.json";
import { formatChecksums, sha256Hex, stem } from "../../scripts/release-lib.mjs";
import { REQUIRED_FILES, SITE, verifyRelease } from "../../scripts/verify-release.mjs";
import { createZip } from "../../scripts/zip-writer.mjs";

const enc = new TextEncoder();
const ZIP_NAME = "synthetic-data-generator-0.2.0-spec3-offline.zip";
const TOP = stem("0.2.0", 3);
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self'; script-src 'self' 'wasm-unsafe-eval'" />`;

type Files = Record<string, string | Uint8Array>;

function goodFiles(): Files {
  const files: Files = {
    "README.txt": "Synthetic Data Generator - offline copy\nVersion 0.2.0 (writes spec file version 3), built 2026-10-31\n",
    "LICENSES.md": "# Licences\n",
    "start.cmd": "@echo off\n",
    "start.ps1": "# launcher\n",
    "start.sh": "#!/bin/sh\n",
    [`${SITE}/index.html`]: `<!doctype html><html><head>${CSP}</head><body><div id="root"></div></body></html>`,
    [`${SITE}/assets/index-abc.js`]: 'const a="0.2.0";',
    [`${SITE}/duckdb/duckdb-eh.wasm`]: new Uint8Array([0, 97, 115, 109]),
    [`${SITE}/duckdb/duckdb-mvp.wasm`]: new Uint8Array([0, 97, 115, 109]),
    [`${SITE}/duckdb/duckdb-browser-eh.worker.js`]: "// worker",
    [`${SITE}/duckdb/duckdb-browser-mvp.worker.js`]: "// worker",
    [`${SITE}/duckdb-ext/VERSION.json`]: "{}",
    [`${SITE}/duckdb-ext/v1.5.4/wasm_eh/excel.duckdb_extension.wasm`]: new Uint8Array([0, 97, 115, 109]),
    [`${SITE}/duckdb-ext/v1.5.4/wasm_mvp/excel.duckdb_extension.wasm`]: new Uint8Array([0, 97, 115, 109]),
  };
  return files;
}

const bytesOf = (v: string | Uint8Array) => (typeof v === "string" ? enc.encode(v) : v);

/** Builds a zip from a file map, with a matching checksum list unless one is given. */
function build(files: Files, { checksums, name = ZIP_NAME, top = TOP }: { checksums?: string | null; name?: string; top?: string } = {}) {
  const all: Files = { ...files };
  if (checksums !== null) {
    all["CHECKSUMS.sha256"] = checksums ?? formatChecksums(Object.entries(files).map(([path, v]) => ({ path, sha256: sha256Hex(bytesOf(v)) })));
  }
  const bytes = createZip(Object.entries(all).map(([path, v]) => ({ path: `${top}/${path}`, data: bytesOf(v) })), { mtime: new Date("2026-01-01T00:00:00Z") });
  return verifyRelease({ zipName: name, bytes, allowlist });
}

describe("a good release", () => {
  it("has every required file in the test builder (so the builder follows the contract)", () => {
    const have = new Set(Object.keys(goodFiles()));
    for (const required of REQUIRED_FILES) {
      if (!required.includes("*") && required !== "CHECKSUMS.sha256") expect(have.has(required), required).toBe(true);
    }
  });

  it("passes", () => {
    expect(build(goodFiles())).toEqual([]);
  });

  it("accepts a host that is on the allowlist and ignores binary files", () => {
    const files = goodFiles();
    files[`${SITE}/assets/index-abc.js`] = 'const a="0.2.0"; const u="https://reactjs.org/docs/error-decoder.html";';
    files[`${SITE}/duckdb/duckdb-eh.wasm`] = enc.encode("https://never-scanned.example.com");
    expect(build(files)).toEqual([]);
  });
});

describe("files that do not belong", () => {
  it.each([
    ["a source map", `${SITE}/assets/index-abc.js.map`],
    ["an environment file", ".env"],
    ["a fixture", "tests/fixtures/real.csv"],
    ["node_modules", "node_modules/x/index.js"],
    ["a spike page", `${SITE}/spike.html`],
    ["a stray file at the top", "notes.txt"],
  ])("fails on %s", (_label, path) => {
    const files = goodFiles();
    files[path] = "x";
    const problems = build(files);
    expect(problems.some((p) => p.includes(path))).toBe(true);
  });
});

describe("files that are missing", () => {
  it.each(REQUIRED_FILES.filter((f) => !f.includes("*") && f !== "CHECKSUMS.sha256"))("fails when %s is missing", (path) => {
    const files = goodFiles();
    delete files[path];
    expect(build(files).some((p) => p.includes(path))).toBe(true);
  });

  it("fails when an engine build has no Excel extension file", () => {
    const files = goodFiles();
    delete files[`${SITE}/duckdb-ext/v1.5.4/wasm_mvp/excel.duckdb_extension.wasm`];
    expect(build(files).some((p) => p.includes("wasm_mvp") && p.includes("excel"))).toBe(true);
  });
});

describe("the checksum list", () => {
  it("fails on a changed file", () => {
    const files = goodFiles();
    const listed = formatChecksums(Object.entries(files).map(([path, v]) => ({ path, sha256: sha256Hex(bytesOf(v)) })));
    files["LICENSES.md"] = "# Licences, edited\n";
    const problems = build(files, { checksums: listed });
    expect(problems.some((p) => p.includes("LICENSES.md") && /does not match/.test(p))).toBe(true);
  });

  it("fails on a file the list does not name, and on a name with no file", () => {
    const files = goodFiles();
    const entries = Object.entries(files).map(([path, v]) => ({ path, sha256: sha256Hex(bytesOf(v)) }));
    const withoutOne = formatChecksums(entries.filter((e) => e.path !== "start.sh"));
    expect(build(files, { checksums: withoutOne }).some((p) => p.includes("start.sh") && /not in CHECKSUMS/.test(p))).toBe(true);
    const withGhost = formatChecksums([...entries, { path: "ghost.txt", sha256: "0".repeat(64) }]);
    expect(build(files, { checksums: withGhost }).some((p) => p.includes("ghost.txt"))).toBe(true);
  });

  it("fails when there is no list, or a line that is not one", () => {
    expect(build(goodFiles(), { checksums: null }).some((p) => p.includes("CHECKSUMS.sha256"))).toBe(true);
    expect(build(goodFiles(), { checksums: "garbage\n" }).some((p) => p.includes("CHECKSUMS.sha256"))).toBe(true);
  });
});

describe("outside addresses", () => {
  it("fails on a host that is not on the allowlist, naming file and host", () => {
    const files = goodFiles();
    files[`${SITE}/assets/index-abc.js`] = 'const a="0.2.0"; fetch("https://tracker.example.com/collect");';
    const problems = build(files);
    expect(problems.some((p) => p.includes("index-abc.js") && p.includes("tracker.example.com"))).toBe(true);
  });

  it("looks at the launcher files too", () => {
    const files = goodFiles();
    files["start.ps1"] = "Invoke-WebRequest https://example.org/x";
    expect(build(files).some((p) => p.includes("start.ps1") && p.includes("example.org"))).toBe(true);
  });

  it("fails on a secret that looks like an access token or private key", () => {
    const files = goodFiles();
    files[`${SITE}/assets/index-abc.js`] = `const a="0.2.0"; const t="ghp_${"a".repeat(36)}";`;
    expect(build(files).some((p) => /token|secret/i.test(p))).toBe(true);
    files[`${SITE}/assets/index-abc.js`] = 'const a="0.2.0"; // -----BEGIN RSA PRIVATE KEY-----';
    expect(build(files).some((p) => /private key|secret/i.test(p))).toBe(true);
  });
});

describe("versions and the page", () => {
  it("fails when the README names another version than the zip", () => {
    const files = goodFiles();
    files["README.txt"] = "Version 0.3.0 (writes spec file version 3), built 2026-10-31\n";
    expect(build(files).some((p) => p.includes("README.txt") && p.includes("0.2.0"))).toBe(true);
    files["README.txt"] = "Version 0.2.0 (writes spec file version 2), built 2026-10-31\n";
    expect(build(files).some((p) => p.includes("README.txt") && p.includes("spec"))).toBe(true);
  });

  it("fails when the build in site/ carries another app version", () => {
    const files = goodFiles();
    files[`${SITE}/assets/index-abc.js`] = 'const a="0.1.0";';
    expect(build(files).some((p) => p.includes("0.2.0") && /site/.test(p))).toBe(true);
  });

  it("fails when the folder inside the zip is not named like the zip", () => {
    expect(build(goodFiles(), { top: "something-else" }).some((p) => p.includes("something-else"))).toBe(true);
  });

  it("fails when the zip name is not a release name", () => {
    expect(build(goodFiles(), { name: "release.zip" }).some((p) => p.includes("release.zip"))).toBe(true);
  });

  it("fails when index.html has no content policy, or one that allows outside connections", () => {
    const files = goodFiles();
    files[`${SITE}/index.html`] = "<!doctype html><html><head></head><body></body></html>";
    expect(build(files).some((p) => /content policy|Content-Security-Policy/i.test(p))).toBe(true);
    files[`${SITE}/index.html`] = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src *; connect-src *"></head></html>`;
    expect(build(files).some((p) => /connect-src/.test(p))).toBe(true);
  });

  it("fails on a zip that cannot be read", () => {
    const problems = verifyRelease({ zipName: ZIP_NAME, bytes: enc.encode("not a zip"), allowlist });
    expect(problems.length).toBeGreaterThan(0);
  });
});
