// @vitest-environment node
// The pure parts of building a release (specs/004 FR-010, FR-012, FR-013): names from versions, the
// checksum list, the tag check and collecting files in a fixed order.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkTag, collectFiles, formatChecksums, normalizeLineEndings, parseChecksums, releaseName, safeJoin, sha256Hex, stem, zipName } from "../../scripts/release-lib.mjs";

describe("names", () => {
  it("builds the stem, zip name and release name from the two versions", () => {
    expect(stem("0.2.0", 3)).toBe("synthetic-data-generator-0.2.0-spec3-offline");
    expect(zipName("0.2.0", 3)).toBe("synthetic-data-generator-0.2.0-spec3-offline.zip");
    expect(releaseName("0.2.0", 3)).toBe("v0.2.0 (writes spec v3)");
  });
});

describe("the checksum list", () => {
  const entries = [
    { path: "site/b.js", sha256: sha256Hex(new TextEncoder().encode("b")) },
    { path: "README.txt", sha256: sha256Hex(new TextEncoder().encode("a")) },
  ];

  it("has one line per file, sorted by path, with LF endings and two spaces", () => {
    const text = formatChecksums(entries);
    const lines = text.split("\n");
    expect(lines.at(-1)).toBe(""); // ends with a newline
    expect(lines.slice(0, 2).map((l) => l.slice(66))).toEqual(["README.txt", "site/b.js"]);
    expect(text).not.toContain("\r");
    expect(lines[0]).toMatch(/^[0-9a-f]{64} {2}README\.txt$/);
  });

  it("is the same whatever the input order", () => {
    expect(formatChecksums([...entries].reverse())).toBe(formatChecksums(entries));
  });

  it("parses back what it writes, and refuses a bad line", () => {
    expect(parseChecksums(formatChecksums(entries))).toEqual([...entries].sort((a, b) => (a.path < b.path ? -1 : 1)));
    expect(() => parseChecksums("not a checksum line\n")).toThrow(/line 1/);
    expect(() => parseChecksums(`${"a".repeat(64)} x\n`)).toThrow(/line 1/);
  });

  it("hashes bytes as sha-256 hex", () => {
    expect(sha256Hex(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("the tag check", () => {
  it("accepts the tag that equals the version", () => {
    expect(checkTag("v0.2.0", "0.2.0")).toEqual({ ok: true });
  });

  it("refuses another tag, a tag without v, and a pre-release tag", () => {
    expect(checkTag("v0.2.1", "0.2.0")).toMatchObject({ ok: false, reason: expect.stringContaining("0.2.1") });
    expect(checkTag("0.2.0", "0.2.0")).toMatchObject({ ok: false });
    expect(checkTag("v0.2.0-rc1", "0.2.0")).toMatchObject({ ok: false });
  });

  it("allows a pre-release of the version in a dry run only", () => {
    expect(checkTag("v0.2.0-rc1", "0.2.0", { dryRun: true })).toEqual({ ok: true });
    expect(checkTag("v0.3.0-rc1", "0.2.0", { dryRun: true })).toMatchObject({ ok: false });
  });
});

describe("line endings", () => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const run = (name: string, text: string) => dec.decode(normalizeLineEndings(name, enc.encode(text)));

  it("puts Windows scripts and the README in CRLF, whatever they came as", () => {
    expect(run("start.cmd", "a\nb\r\nc")).toBe("a\r\nb\r\nc");
    expect(run("start.ps1", "a\r\nb")).toBe("a\r\nb");
    expect(run("README.txt", "a\nb")).toBe("a\r\nb");
  });

  it("puts the Unix script, notes and index.html in LF, so a Windows checkout builds the same zip", () => {
    expect(run("start.sh", "a\r\nb\r\n")).toBe("a\nb\n");
    expect(run("LICENSES.md", "a\r\nb")).toBe("a\nb");
    expect(run("index.html", "<html>\r\n</html>\r\n")).toBe("<html>\n</html>\n");
    expect(run("index.html", "<html>\n</html>")).toBe("<html>\n</html>\n"); // one final newline, with or without
    expect(run("index.html", "<html>\n</html>\n\n\n")).toBe("<html>\n</html>\n");
  });

  it("leaves binary files and bundles alone", () => {
    const wasm = new Uint8Array([0, 13, 10, 97]);
    expect(normalizeLineEndings("x.wasm", wasm)).toBe(wasm);
    const js = enc.encode("a\r\nb");
    expect(normalizeLineEndings("index-abc.js", js)).toBe(js);
  });
});

describe("files", () => {
  const dir = mkdtempSync(join(tmpdir(), "rel lib "));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("collects every file sorted by path with forward slashes", async () => {
    mkdirSync(join(dir, "z", "deep"), { recursive: true });
    mkdirSync(join(dir, "a"));
    writeFileSync(join(dir, "z", "deep", "f.txt"), "1");
    writeFileSync(join(dir, "a", "g.txt"), "2");
    writeFileSync(join(dir, "m.txt"), "3");
    expect(await collectFiles(dir)).toEqual(["a/g.txt", "m.txt", "z/deep/f.txt"]);
  });

  it("joins a path inside the folder and refuses one outside it", () => {
    expect(safeJoin(dir, "a/g.txt")).toBe(join(dir, "a", "g.txt"));
    expect(() => safeJoin(dir, "../x")).toThrow(/outside/);
    expect(() => safeJoin(dir, "a/../../x")).toThrow(/outside/);
    expect(() => safeJoin(dir, "/etc/passwd")).toThrow(/outside/);
  });
});
