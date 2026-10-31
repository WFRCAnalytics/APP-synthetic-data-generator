// @vitest-environment node
// The streaming workbook writer (specs/003 FR-006, FR-008, FR-011, research R7): the parts of the package,
// one style per format code, cell types from the column kind, rows above the header, and that the
// result reads back with the package reader (and with openpyxl, when Python has it).

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EMPTY_TEXT_TOKEN } from "../../src/lib/spec/types";
import { inspectSheet, inspectWorkbook } from "../../src/lib/xlsx/metadata";
import { workbookBytes, type XlsxLayout } from "../../src/lib/xlsx/writer";
import { readEntryText, readZipDirectory } from "../../src/lib/xlsx/zip";

const layout = (over: Partial<XlsxLayout> = {}): XlsxLayout => ({
  sheet: "Survey Data",
  skipRows: 2,
  header: true,
  date1904: false,
  nRows: 3,
  columns: [
    { name: "id", kind: "text", format: "@" },
    { name: "amount", kind: "number", format: "#,##0.00" },
    { name: "when", kind: "date", format: "mm/dd/yyyy" },
  ],
  ...over,
});

const rows3 = [
  ["00001", "1234.5", "2024-01-01"],
  ["00002", "10", "2024-01-04"],
  ["00003", "-0.25", "2024-02-29"],
];

async function build(l: XlsxLayout, rows: string[][]) {
  const blob = new Blob([await workbookBytes(l, rows)] as BlobPart[]);
  const entries = await readZipDirectory(blob);
  const part = async (name: string) => readEntryText(blob, entries.find((e) => e.name === name)!);
  return { blob, entries, part, sheet: () => part("xl/worksheets/sheet1.xml") };
}

describe("the package", () => {
  it("holds the parts Excel needs, content types first", async () => {
    const { entries } = await build(layout(), rows3);
    expect(entries.map((e) => e.name)).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]);
  });

  it("names the sheet exactly, escaping what XML needs", async () => {
    const { part } = await build(layout({ sheet: "Q&A <2024> \"x\"" }), rows3);
    const xml = await part("xl/workbook.xml");
    expect(xml).toContain('name="Q&amp;A &lt;2024&gt; &quot;x&quot;"');
  });

  it("keeps a sheet name with spaces and accents", async () => {
    const { blob } = await build(layout({ sheet: "Résumé 2024" }), rows3);
    expect((await inspectWorkbook(blob)).sheets.map((s) => s.name)).toEqual(["Résumé 2024"]);
  });

  it("records the 1904 date system, and only then", async () => {
    expect(await (await build(layout({ date1904: true }), rows3)).part("xl/workbook.xml")).toMatch(/date1904="1"/);
    expect(await (await build(layout(), rows3)).part("xl/workbook.xml")).not.toMatch(/date1904/);
  });
});

describe("rows", () => {
  it("leaves the rows above the header empty and puts the header on the next row", async () => {
    const xml = await (await build(layout(), rows3)).sheet();
    expect(xml).not.toContain('<row r="1"');
    expect(xml).not.toContain('<row r="2"');
    expect(xml).toContain('<row r="3"');
    expect(xml.indexOf('<c r="A3"')).toBeGreaterThan(-1);
    expect(xml).toContain('<c r="A4"'); // the first data row
    expect(xml).toContain('<c r="A6"'); // the third data row
    expect(xml).not.toContain('<c r="A7"');
  });

  it("writes no header row when the sheet has none, and starts the data right after the skipped rows", async () => {
    const xml = await (await build(layout({ header: false, skipRows: 0 }), rows3)).sheet();
    expect(xml).toContain('<c r="A1" t="inlineStr"><is><t>00001</t></is></c>'.replace(' t="inlineStr"', ' s="1" t="inlineStr"'));
    expect(xml).not.toContain("<t>id</t>");
  });

  it("states the used range", async () => {
    expect(await (await build(layout(), rows3)).sheet()).toContain('<dimension ref="A3:C6"/>');
    expect(await (await build(layout({ header: false, skipRows: 0 }), rows3)).sheet()).toContain('<dimension ref="A1:C3"/>');
  });

  it("uses column letters past Z", async () => {
    const columns = Array.from({ length: 30 }, (_, i) => ({ name: `c${i}`, kind: "number" as const }));
    const xml = await (await build(layout({ columns, skipRows: 0, nRows: 1 }), [Array.from({ length: 30 }, (_, i) => String(i))])).sheet();
    expect(xml).toContain('<c r="AA1"');
    expect(xml).toContain('<c r="AD2"');
    expect(xml).toContain('<dimension ref="A1:AD2"/>');
  });

  it("writes nothing for a zero-row table but the header", async () => {
    const xml = await (await build(layout({ nRows: 0 }), [])).sheet();
    expect(xml).toContain('<row r="3"');
    expect(xml).not.toContain('<row r="4"');
  });
});

describe("cells", () => {
  it("writes a number as a number with its column's style, not as text", async () => {
    const xml = await (await build(layout(), rows3)).sheet();
    expect(xml).toMatch(/<c r="B4" s="\d+"><v>1234\.5<\/v><\/c>/);
    expect(xml).toMatch(/<c r="B6" s="\d+"><v>-0\.25<\/v><\/c>/);
  });

  it("writes text that looks like a number as text, keeping its zeros", async () => {
    const xml = await (await build(layout(), rows3)).sheet();
    expect(xml).toMatch(/<c r="A4" s="\d+" t="inlineStr"><is><t>00001<\/t><\/is><\/c>/);
  });

  it("writes a date as a serial number in the workbook's date system", async () => {
    expect(await (await build(layout(), rows3)).sheet()).toMatch(/<c r="C4" s="\d+"><v>45292<\/v><\/c>/);
    expect(await (await build(layout({ date1904: true }), rows3)).sheet()).toMatch(/<c r="C4" s="\d+"><v>43830<\/v><\/c>/);
  });

  it("writes a date and time, and a time, as fractions of a day", async () => {
    const l = layout({ nRows: 1, columns: [{ name: "at", kind: "datetime", format: "yyyy-mm-dd hh:mm:ss" }, { name: "t", kind: "time", format: "hh:mm:ss" }] });
    const xml = await (await build(l, [["2024-01-01 12:00:00", "06:00:00"]])).sheet();
    expect(xml).toMatch(/<c r="A4" s="\d+"><v>45292\.5<\/v><\/c>/);
    expect(xml).toMatch(/<c r="B4" s="\d+"><v>0\.25<\/v><\/c>/);
  });

  it("writes true and false as boolean cells", async () => {
    const l = layout({ nRows: 2, columns: [{ name: "ok", kind: "boolean" }] });
    const xml = await (await build(l, [["TRUE"], ["FALSE"]])).sheet();
    expect(xml).toContain('<c r="A4" t="b"><v>1</v></c>');
    expect(xml).toContain('<c r="A5" t="b"><v>0</v></c>');
  });

  it("leaves a blank cell out, and writes empty text as an empty string cell", async () => {
    const l = layout({ nRows: 2, columns: [{ name: "a", kind: "text" }, { name: "b", kind: "text" }] });
    const xml = await (await build(l, [["", "x"], [EMPTY_TEXT_TOKEN, "y"]])).sheet();
    expect(xml).not.toContain('<c r="A4"');
    expect(xml).toContain('<c r="B4"');
    expect(xml).toContain('<c r="A5" t="inlineStr"><is><t></t></is></c>');
  });

  it("writes what a number column cannot hold as text, such as a code or a marker", async () => {
    const l = layout({ nRows: 2, columns: [{ name: "n", kind: "number" }] });
    const xml = await (await build(l, [["NA"], ["-9"]])).sheet();
    expect(xml).toContain('<c r="A4" t="inlineStr"><is><t>NA</t></is></c>');
    expect(xml).toMatch(/<c r="A5"><v>-9<\/v><\/c>/);
  });

  it("escapes text, keeps edge spaces and line breaks, and drops control characters", async () => {
    const l = layout({ nRows: 3, columns: [{ name: "t", kind: "text" }] });
    const xml = await (await build(l, [["a & b <c>"], [" lead and trail "], ["line1\nline2\u0001"]])).sheet();
    expect(xml).toContain("<t>a &amp; b &lt;c&gt;</t>");
    expect(xml).toContain('<t xml:space="preserve"> lead and trail </t>');
    expect(xml).toContain('<t xml:space="preserve">line1\nline2</t>');
  });

  it("strips thousands separators from a number it is given", async () => {
    const l = layout({ nRows: 1, columns: [{ name: "n", kind: "number" }] });
    expect(await (await build(l, [["1,234.5"]])).sheet()).toMatch(/<v>1234\.5<\/v>/);
  });

  it("writes a date it cannot place as text, rather than a wrong date", async () => {
    const l = layout({ nRows: 1, columns: [{ name: "d", kind: "date", format: "mm/dd/yyyy" }] });
    expect(await (await build(l, [["1850-01-01"]])).sheet()).toContain("<t>1850-01-01</t>");
  });
});

describe("styles", () => {
  it("makes one style per format code, reused by columns that share it", async () => {
    const l = layout({ nRows: 1, columns: [{ name: "a", kind: "number", format: "0.00" }, { name: "b", kind: "number", format: "0.00" }, { name: "c", kind: "number", format: "0.0%" }, { name: "d", kind: "number" }] });
    const { part, sheet } = await build(l, [["1", "2", "0.5", "4"]]);
    const styles = await part("xl/styles.xml");
    expect(styles.match(/<numFmt /g)?.length).toBe(2);
    expect(styles).toContain('formatCode="0.00"');
    expect(styles).toContain('formatCode="0.0%"');
    const xml = await sheet();
    const s = (ref: string) => new RegExp(`<c r="${ref}"(?: s="(\\d+)")?`).exec(xml)?.[1];
    expect(s("A4")).toBe(s("B4"));
    expect(s("A4")).not.toBe(s("C4"));
    expect(s("D4")).toBeUndefined(); // general: no style attribute
  });

  it("escapes a format code and uses the built-in id for text", async () => {
    const l = layout({ nRows: 1, columns: [{ name: "a", kind: "number", format: '0.00" <units>"' }, { name: "b", kind: "text", format: "@" }] });
    const styles = await (await build(l, [["1", "x"]])).part("xl/styles.xml");
    expect(styles).toContain('formatCode="0.00&quot; &lt;units&gt;&quot;"');
    expect(styles).toContain('numFmtId="49"');
  });
});

describe("reads back with the package reader", () => {
  it("gives the same sheet, header position, width and formats", async () => {
    const { blob } = await build(layout(), rows3);
    const info = await inspectWorkbook(blob);
    expect(info.sheets.map((s) => s.name)).toEqual(["Survey Data"]);
    const hints = await inspectSheet(blob, "Survey Data");
    expect(hints.suggestedSkipRows).toBe(2);
    expect(hints.firstCol).toBe(0);
    expect(hints.lastCol).toBe(2);
    expect(hints.formats).toEqual(["@", "#,##0.00", "mm/dd/yyyy"]);
    expect(hints.mergedCells).toBe(false);
  });

  it("carries the date system", async () => {
    expect((await inspectWorkbook((await build(layout({ date1904: true }), rows3)).blob)).date1904).toBe(true);
  });
});

const hasOpenpyxl = spawnSync("python", ["-c", "import openpyxl"]).status === 0;

describe.skipIf(!hasOpenpyxl)("reads back with openpyxl, an independent reader", () => {
  it("sees the same sheet, header, values, types and number formats", async () => {
    const l = layout({ nRows: 4, columns: [...layout().columns, { name: "ok", kind: "boolean" }, { name: "note", kind: "text" }] });
    const { blob } = await build(l, [
      ["00001", "1234.5", "2024-01-01", "TRUE", "a"],
      ["00002", "10", "2024-01-04", "FALSE", ""],
      ["00003", "-0.25", "2024-02-29", "TRUE", EMPTY_TEXT_TOKEN],
      ["00004", "NA", "2024-03-01", "FALSE", "z"],
    ]);
    const dir = mkdtempSync(join(tmpdir(), "xlsx-"));
    const path = join(dir, "fake.xlsx");
    writeFileSync(path, new Uint8Array(await blob.arrayBuffer()));
    const code = [
      "import openpyxl, json, sys",
      "wb = openpyxl.load_workbook(sys.argv[1])",
      "ws = wb['Survey Data']",
      "out = {'sheets': wb.sheetnames, 'header': [c.value for c in ws[3]], 'first': [c.value for c in ws[4]], 'formats': [c.number_format for c in ws[4]][:3], 'types': [c.data_type for c in ws[4]], 'skipped_empty': all(c.value is None for c in ws[1]) and all(c.value is None for c in ws[2]), 'empty_text': repr(ws['E6'].value), 'blank': repr(ws['E5'].value), 'marker': ws['B7'].value}",
      "print(json.dumps(out, default=str))",
    ].join("\n");
    const r = spawnSync("python", ["-c", code, path], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const got = JSON.parse(r.stdout);
    expect(got.sheets).toEqual(["Survey Data"]);
    expect(got.header).toEqual(["id", "amount", "when", "ok", "note"]);
    expect(got.first[0]).toBe("00001"); // text, zeros kept
    expect(got.first[1]).toBe(1234.5);
    expect(String(got.first[2])).toContain("2024-01-01");
    expect(got.first[3]).toBe(true);
    expect(got.formats).toEqual(["@", "#,##0.00", "mm/dd/yyyy"]);
    expect(got.types.slice(0, 4)).toEqual(["s", "n", "d", "b"]);
    expect(got.skipped_empty).toBe(true);
    expect(got.blank).toBe("None");
    expect(got.empty_text).toBe("''");
    expect(got.marker).toBe("NA"); // a marker in a number column is kept as text
  });
});
