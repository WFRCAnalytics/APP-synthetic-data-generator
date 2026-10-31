// @vitest-environment node
// The zip writer for releases (specs/004 FR-012, R7): the same files give the same bytes, entries are in
// path order with a fixed time, and other readers can open the result.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createZip } from "../../scripts/zip-writer.mjs";
import { readEntryText, readZipDirectory } from "../../src/lib/xlsx/zip";

const enc = new TextEncoder();
const MTIME = new Date("2026-01-01T00:00:00Z");
const files = [
  { path: "site/z.txt", data: enc.encode("zzz ".repeat(500)) },
  { path: "README.txt", data: enc.encode("read me") },
  { path: "dir with space/naïve é.txt", data: enc.encode("unicode name") },
  { path: "start.sh", data: enc.encode("#!/bin/sh\n"), mode: 0o755 },
  { path: "empty.bin", data: new Uint8Array() },
];

describe("createZip", () => {
  it("gives equal bytes for the same files, whatever the input order", () => {
    const a = createZip(files, { mtime: MTIME });
    const b = createZip([...files].reverse(), { mtime: MTIME });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("changes when the time or a file changes", () => {
    const a = createZip(files, { mtime: MTIME });
    expect(Buffer.from(createZip(files, { mtime: new Date("2027-01-01T00:00:00Z") })).equals(Buffer.from(a))).toBe(false);
    const changed = files.map((f) => (f.path === "README.txt" ? { ...f, data: enc.encode("read me!") } : f));
    expect(Buffer.from(createZip(changed, { mtime: MTIME })).equals(Buffer.from(a))).toBe(false);
  });

  it("lists entries sorted by path and reads back with the app's own reader", async () => {
    const blob = new Blob([createZip(files, { mtime: MTIME }) as BlobPart]);
    const entries = await readZipDirectory(blob);
    expect(entries.map((e) => e.name)).toEqual(["README.txt", "dir with space/naïve é.txt", "empty.bin", "site/z.txt", "start.sh"]);
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
    expect(await readEntryText(blob, byName["README.txt"])).toBe("read me");
    expect(await readEntryText(blob, byName["dir with space/naïve é.txt"])).toBe("unicode name");
    expect(await readEntryText(blob, byName["site/z.txt"])).toBe("zzz ".repeat(500));
  });

  it("compresses a repetitive file", () => {
    const zip = createZip([{ path: "z.txt", data: enc.encode("zzz ".repeat(500)) }], { mtime: MTIME });
    expect(zip.length).toBeLessThan(500); // 2,000 bytes of text, plus headers
  });

  const hasPython = spawnSync("python", ["-c", "import zipfile"]).status === 0;
  const dir = mkdtempSync(join(tmpdir(), "rel zip "));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.skipIf(!hasPython)("opens in Python's zipfile with the fixed time and the executable bit on start.sh", () => {
    const path = join(dir, "t.zip");
    writeFileSync(path, createZip(files, { mtime: MTIME }));
    const code = [
      "import zipfile, json, sys",
      "z = zipfile.ZipFile(sys.argv[1])",
      "print(json.dumps({'bad': z.testzip(), 'names': z.namelist(), 'dates': [str(i.date_time) for i in z.infolist()], 'sh': oct(z.getinfo('start.sh').external_attr >> 16), 'txt': oct(z.getinfo('README.txt').external_attr >> 16)}))",
    ].join("\n");
    const r = spawnSync("python", ["-c", code, path], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.bad).toBeNull();
    expect(out.names).toContain("dir with space/naïve é.txt");
    expect(new Set(out.dates)).toEqual(new Set(["(2026, 1, 1, 0, 0, 0)"]));
    expect(out.sh).toBe("0o100755");
    expect(out.txt).toBe("0o100644");
  });
});
