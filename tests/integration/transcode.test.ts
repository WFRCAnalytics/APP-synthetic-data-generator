// @vitest-environment node
// UTF-16 big endian and Windows-1252 cannot be read natively by DuckDB (spike R2), so they are
// transcoded to UTF-8 first. Check that the result loads and holds the same data as the UTF-8 file.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCsv } from "../../src/workers/profile/load";
import { columnNamesFor, detectFileSettings } from "../../src/workers/profile/open";
import { readModeFor, transcodeToUtf8 } from "../../src/workers/profile/transcode";
import { createNodeDb, openFromDisk, type NodeDb } from "../helpers/duckdbNode";

const ZOO = join(__dirname, "../fixtures/zoo");
let db: NodeDb;

beforeAll(async () => {
  db = await createNodeDb();
}, 60_000);
afterAll(() => db?.close());

const bytesOf = (name: string) => new Uint8Array(readFileSync(join(ZOO, name)));

describe("read modes", () => {
  it("reads UTF-8 and UTF-16 LE natively and transcodes the rest", () => {
    expect(readModeFor("utf-8")).toEqual({ kind: "native", encoding: "utf-8" });
    expect(readModeFor("utf-16le")).toEqual({ kind: "native", encoding: "utf-16" });
    expect(readModeFor("utf-16be")).toEqual({ kind: "transcode" });
    expect(readModeFor("windows-1252")).toEqual({ kind: "transcode" });
  });
});

describe("transcoding", () => {
  it.each(["variant_utf16be.csv", "variant_cp1252.csv"])("turns %s into the same UTF-8 text as the UTF-8 variant", async (file) => {
    const utf8 = new TextDecoder().decode(bytesOf("variant_utf8.csv"));
    const opened = openFromDisk(join(ZOO, file));
    const out = await transcodeToUtf8(new Blob([bytesOf(file)]), opened.settings.encoding);
    expect(new TextDecoder().decode(out)).toBe(utf8);
  });

  it("reports progress", async () => {
    const seen: number[] = [];
    await transcodeToUtf8(new Blob([bytesOf("variant_utf16be.csv")]), "utf-16be", (done) => seen.push(done));
    expect(seen.length).toBeGreaterThan(0);
  });

  it.each(["variant_utf16be.csv", "variant_cp1252.csv"])("loads %s into the table with the right rows and characters", async (file) => {
    const opened = openFromDisk(join(ZOO, file));
    const utf8 = await transcodeToUtf8(new Blob([bytesOf(file)]), opened.settings.encoding);
    db.registerBuffer(`t_${file}`, utf8);
    const loaded = await loadCsv(db.sql, `t_${file}`, opened.settings, opened.columnNames, "utf-8");
    expect(loaded.rowCount).toBe(200);
    expect(loaded.columnNames).toEqual(["id", "label", "amount", "when", "flag", "note"]);
    const rows = await db.sql.all(`SELECT DISTINCT label FROM src WHERE label LIKE '%€%' OR label LIKE '%é%'`);
    expect(rows.map((r) => r.label)).toEqual(expect.arrayContaining(["Café", "€5"]));
  });
});

describe("native UTF-16 little endian", () => {
  it("loads without transcoding", async () => {
    const opened = openFromDisk(join(ZOO, "variant_utf16le.csv"));
    db.registerPath("le.csv", join(ZOO, "variant_utf16le.csv"));
    const loaded = await loadCsv(db.sql, "le.csv", opened.settings, opened.columnNames, "utf-16");
    expect(loaded.rowCount).toBe(200);
  });
});

describe("column names follow the settings the user edits", () => {
  const file = "variant_utf8.csv";
  const bytes = bytesOf(file);

  it("uses the header row when there is one", () => {
    const { settings } = detectFileSettings(bytes, bytes.subarray(-8), bytes.length);
    expect(columnNamesFor(bytes, settings, bytes.length)).toEqual(["id", "label", "amount", "when", "flag", "note"]);
  });

  it("numbers the columns when the user says there is no header", () => {
    const { settings } = detectFileSettings(bytes, bytes.subarray(-8), bytes.length);
    expect(columnNamesFor(bytes, { ...settings, header: false }, bytes.length)).toEqual(["column_1", "column_2", "column_3", "column_4", "column_5", "column_6"]);
  });

  it("re-reads the names when the delimiter changes", () => {
    const { settings } = detectFileSettings(bytes, bytes.subarray(-8), bytes.length);
    expect(columnNamesFor(bytes, { ...settings, delimiter: "|" }, bytes.length)).toHaveLength(1);
  });
});
