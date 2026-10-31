// @vitest-environment node
// The zip container of an .xlsx (specs/003 research R7, R11): reading the central directory of real
// workbooks, reading deflated and stored entries, and writing a streamed zip that other zip readers
// accept. Python's own `zipfile` is the independent check when Python is available.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ZipError, crc32, createZipWriter, readEntryHead, readEntryText, readZipDirectory } from "../../src/lib/xlsx/zip";

const FIX = join(__dirname, "../fixtures/xlsx");
const blobOf = (path: string) => new Blob([new Uint8Array(readFileSync(path))]);
const enc = new TextEncoder();
const pythonHas = spawnSync("python", ["-c", "import zipfile"]).status === 0;

async function zipOf(entries: { name: string; text: string; store?: boolean }[]): Promise<Blob> {
  const parts: Uint8Array[] = [];
  const zip = createZipWriter((c) => void parts.push(c));
  for (const e of entries) await zip.addEntry(e.name, [enc.encode(e.text)], { store: e.store });
  await zip.finish();
  return new Blob(parts as BlobPart[]);
}

describe("crc32", () => {
  it("matches the known check values", () => {
    expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(enc.encode("a"))).toBe(0xe8b7be43);
  });

  it("can be continued over chunks", () => {
    const whole = crc32(enc.encode("hello world"));
    expect(crc32(enc.encode(" world"), crc32(enc.encode("hello")))).toBe(whole);
  });
});

describe("reading real workbooks", () => {
  it("lists the parts of a workbook written by another tool", async () => {
    const entries = await readZipDirectory(blobOf(join(FIX, "quirks.xlsx")));
    const names = entries.map((e) => e.name);
    expect(names).toContain("xl/workbook.xml");
    expect(names).toContain("xl/styles.xml");
    expect(names).toContain("xl/worksheets/sheet2.xml");
    const sheet = entries.find((e) => e.name === "xl/worksheets/sheet2.xml")!;
    expect(sheet.uncompressedSize).toBeGreaterThan(sheet.compressedSize);
  });

  it("reads an entry's text", async () => {
    const blob = blobOf(join(FIX, "quirks.xlsx"));
    const entries = await readZipDirectory(blob);
    const xml = await readEntryText(blob, entries.find((e) => e.name === "xl/workbook.xml")!);
    expect(xml).toContain('<sheet name="Survey Data"');
  });

  it("reads only the head of a big entry", async () => {
    const blob = blobOf(join(FIX, "quirks.xlsx"));
    const entries = await readZipDirectory(blob);
    const sheet = entries.find((e) => e.name === "xl/worksheets/sheet2.xml")!;
    const head = await readEntryHead(blob, sheet, 300);
    expect(head.length).toBeGreaterThanOrEqual(300);
    expect(head.length).toBeLessThan(sheet.uncompressedSize);
    expect(new TextDecoder().decode(head)).toContain("<worksheet");
  });

  it("refuses a truncated file, and a file that is not a zip", async () => {
    await expect(readZipDirectory(blobOf(join(FIX, "damaged.xlsx")))).rejects.toBeInstanceOf(ZipError);
    await expect(readZipDirectory(new Blob([enc.encode("just some text, not a zip file at all")]))).rejects.toBeInstanceOf(ZipError);
    await expect(readZipDirectory(new Blob([]))).rejects.toBeInstanceOf(ZipError);
  });
});

describe("writing a streamed zip", () => {
  const entries = [
    { name: "a.txt", text: "hello hello hello hello hello" },
    { name: "dir/b.xml", text: "<x>" + "y".repeat(5000) + "</x>" },
    { name: "empty.txt", text: "" },
    { name: "stored.txt", text: "kept as it is", store: true },
    { name: "ünï.txt", text: "accented name" },
  ];

  it("reads back with our own reader, whatever the entry kind", async () => {
    const blob = await zipOf(entries);
    const listed = await readZipDirectory(blob);
    expect(listed.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    for (const e of entries) expect(await readEntryText(blob, listed.find((l) => l.name === e.name)!)).toBe(e.text);
    expect(listed.find((l) => l.name === "dir/b.xml")!.compressedSize).toBeLessThan(200); // it was deflated
    expect(listed.find((l) => l.name === "stored.txt")!.compressedSize).toBe("kept as it is".length);
  });

  it("takes chunks, and gives the same result as one piece", async () => {
    const parts: Uint8Array[] = [];
    const zip = createZipWriter((c) => void parts.push(c));
    async function* chunks() {
      for (const piece of ["<root>", "x".repeat(10_000), "</root>"]) yield enc.encode(piece);
    }
    await zip.addEntry("chunked.xml", chunks());
    await zip.finish();
    const blob = new Blob(parts as BlobPart[]);
    const [entry] = await readZipDirectory(blob);
    expect(await readEntryText(blob, entry)).toBe("<root>" + "x".repeat(10_000) + "</root>");
    expect(entry.uncompressedSize).toBe(10_013);
  });

  it("records the CRC-32 of each entry", async () => {
    const blob = await zipOf([{ name: "n.txt", text: "123456789" }]);
    const [entry] = await readZipDirectory(blob);
    expect(entry.crc32).toBe(0xcbf43926);
  });

  it.skipIf(!pythonHas)("is accepted by Python's zipfile, which also checks every CRC", async () => {
    const blob = await zipOf(entries);
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    const path = join(dir, "t.zip");
    writeFileSync(path, new Uint8Array(await blob.arrayBuffer()));
    const code = `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(sorted(z.namelist()))\nprint(z.read('a.txt').decode())`;
    const r = spawnSync("python", ["-c", code, path], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("a.txt");
    expect(r.stdout).toContain("hello hello hello hello hello");
  });

  it("refuses an entry name that is empty, absolute or goes up a folder", async () => {
    const zip = createZipWriter(() => {});
    for (const bad of ["", "/abs.txt", "../up.txt", "a/../../b.txt"]) await expect(zip.addEntry(bad, [enc.encode("x")])).rejects.toBeInstanceOf(ZipError);
  });
});
