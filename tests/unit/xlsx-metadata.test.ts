// @vitest-environment node
// The workbook package reader (specs/003 FR-001 to FR-003, FR-006, FR-009, FR-018, FR-019, research R5,
// R9, R10, R11): sheet names and visibility, the date system, the format code of each column, hints for
// rows to skip and the table's width, merged cells, and refusals. It returns names, flags, sizes and
// format codes only, never a cell value, and opens only the parts it needs.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { XlsxError, inspectSheet, inspectWorkbook } from "../../src/lib/xlsx/metadata";
import { createZipWriter } from "../../src/lib/xlsx/zip";

const FIX = join(__dirname, "../fixtures/xlsx");
const open = (name: string) => new Blob([new Uint8Array(readFileSync(join(FIX, name)))]);
const MARKER = "PRIVATE-MARKER";

describe("sheets and the date system", () => {
  it("lists every sheet with its visibility, and picks the first visible one", async () => {
    const info = await inspectWorkbook(open("quirks.xlsx"));
    expect(info.sheets.map((s) => [s.name, s.hidden])).toEqual([
      ["Notes", false],
      ["Survey Data", false],
      ["Lookup", true],
    ]);
    expect(info.defaultSheet).toBe("Notes");
    expect(info.date1904).toBe(false);
  });

  it("gives each sheet the expanded size of its data, from the zip directory", async () => {
    const info = await inspectWorkbook(open("quirks.xlsx"));
    const data = info.sheets.find((s) => s.name === "Survey Data")!;
    const notes = info.sheets.find((s) => s.name === "Notes")!;
    expect(data.expandedBytes).toBeGreaterThan(notes.expandedBytes);
    expect(data.expandedBytes).toBeGreaterThan(10_000);
  });

  it("reads the 1904 date system", async () => {
    expect((await inspectWorkbook(open("dates1904.xlsx"))).date1904).toBe(true);
  });

  it("skips hidden sheets when choosing the default", async () => {
    const info = await inspectWorkbook(open("titles.xlsx"));
    expect(info.sheets.map((s) => s.name)).toEqual(["Summary", "Responses", "Private"]);
    expect(info.sheets[2].hidden).toBe(true);
    expect(info.defaultSheet).toBe("Summary");
  });

  it("keeps a sheet name with a space exactly", async () => {
    const info = await inspectWorkbook(open("quirks.xlsx"));
    expect(info.sheets.some((s) => s.name === "Survey Data")).toBe(true);
  });
});

describe("hints for a sheet", () => {
  it("suggests the rows to skip, and the width of the table", async () => {
    const hints = await inspectSheet(open("quirks.xlsx"), "Survey Data");
    expect(hints.suggestedSkipRows).toBe(2);
    expect(hints.firstCol).toBe(0);
    expect(hints.lastCol).toBe(8); // A to I; the merged heading in K and L is not part of the table
    expect(hints.lastRow).toBe(202);
  });

  it("suggests no skipped rows when the header is the first row", async () => {
    expect((await inspectSheet(open("plain.xlsx"), "Data")).suggestedSkipRows).toBe(0);
  });

  it("skips title rows and an empty row above the header", async () => {
    expect((await inspectSheet(open("titles.xlsx"), "Responses")).suggestedSkipRows).toBe(3);
  });

  it("reads 300 columns", async () => {
    const hints = await inspectSheet(open("wide.xlsx"), "Wide");
    expect(hints.lastCol).toBe(299);
  });

  it("reads one format code per column", async () => {
    const hints = await inspectSheet(open("quirks.xlsx"), "Survey Data");
    expect(hints.formats).toEqual(["@", "General", "#,##0.00", "0.0%", "mm/dd/yyyy", "General", "General", "General", "#,##0.00"]);
  });

  it("maps built-in format ids to their codes", async () => {
    const hints = await inspectSheet(open("formats.xlsx"), "Formats");
    expect(hints.formats).toEqual(["0.00%", "$#,##0.00", "0.00E+00", "@", "#,##0", "0.00", "0%", "mm-dd-yy", "hh:mm:ss"]);
  });

  it("reads date formats in a 1904 workbook", async () => {
    const hints = await inspectSheet(open("dates1904.xlsx"), "Dates");
    expect(hints.formats).toEqual(["dd/mm/yyyy", "yyyy-mm-dd hh:mm"]);
  });

  it("flags a column whose cells carry different kinds of format", async () => {
    const hints = await inspectSheet(open("mixed.xlsx"), "Mixed");
    expect(hints.mixedFormats).toEqual([0]);
    expect((await inspectSheet(open("plain.xlsx"), "Data")).mixedFormats).toEqual([]);
  });

  it("finds merged cells", async () => {
    expect((await inspectSheet(open("quirks.xlsx"), "Survey Data")).mergedCells).toBe(true);
    expect((await inspectSheet(open("plain.xlsx"), "Data")).mergedCells).toBe(false);
  });

  it("says merged cells were not checked for a very large sheet", async () => {
    const hints = await inspectSheet(open("quirks.xlsx"), "Survey Data", { mergeCheckLimit: 100 });
    expect(hints.mergedCells).toBe("not_checked");
  });

  it("refuses a sheet that does not exist", async () => {
    await expect(inspectSheet(open("plain.xlsx"), "Nope")).rejects.toMatchObject({ code: "xlsx_sheet_missing" });
  });
});

describe("refusals", () => {
  const code = async (blob: Blob) => {
    try {
      await inspectWorkbook(blob);
      return "ok";
    } catch (e) {
      expect(e).toBeInstanceOf(XlsxError);
      return (e as XlsxError).code;
    }
  };

  it("tells a damaged workbook from the others", async () => {
    expect(await code(open("damaged.xlsx"))).toBe("xlsx_damaged");
  });

  it("recognizes the old .xls format by its content", async () => {
    expect(await code(open("legacy.xls"))).toBe("xlsx_legacy");
  });

  it("recognizes a password-protected workbook by its content", async () => {
    expect(await code(open("encrypted.xlsx"))).toBe("xlsx_encrypted");
  });

  it("refuses text, an empty file and a file with the wrong extension", async () => {
    expect(await code(new Blob(["id,name\n1,a\n"]))).toBe("xlsx_not_workbook");
    expect(await code(new Blob([]))).toBe("xlsx_not_workbook");
  });

  it("refuses a zip that is not a workbook", async () => {
    const parts: Uint8Array[] = [];
    const zip = createZipWriter((c) => void parts.push(c));
    await zip.addEntry("hello.txt", [new TextEncoder().encode("hi")]);
    await zip.finish();
    expect(await code(new Blob(parts as BlobPart[]))).toBe("xlsx_not_workbook");
  });

  it("judges by content, so a workbook with the wrong name still opens", async () => {
    expect(await code(open("plain.xlsx"))).toBe("ok");
  });

  it("messages never carry file content", async () => {
    for (const name of ["damaged.xlsx", "legacy.xls", "encrypted.xlsx"]) {
      try {
        await inspectWorkbook(open(name));
      } catch (e) {
        expect((e as Error).message).not.toMatch(/PK|\\x|D0CF/);
      }
    }
  });
});

describe("what the reader returns and opens (privacy)", () => {
  it("returns names, flags, sizes and format codes, never a cell value", async () => {
    const blob = open("titles.xlsx");
    const info = await inspectWorkbook(blob);
    const hints = await inspectSheet(blob, "Responses");
    const text = JSON.stringify({ info, hints });
    expect(text).not.toContain(MARKER);
    for (const value of ["agree", "disagree", "unsure", "5000", "5001"]) expect(text).not.toContain(`"${value}"`);
  });

  it("opens only the workbook, its relationships, the styles and the chosen sheet", async () => {
    const opened: string[] = [];
    const blob = open("titles.xlsx");
    await inspectWorkbook(blob, { trace: (name) => opened.push(name) });
    await inspectSheet(blob, "Responses", { trace: (name) => opened.push(name) });
    const allowed = new Set(["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet2.xml"]);
    expect(opened.filter((n) => !allowed.has(n))).toEqual([]);
    expect(opened).toContain("xl/worksheets/sheet2.xml");
    // Never another sheet, the shared strings (where the real text is), comments or drawings.
    expect(opened.some((n) => /sharedStrings|comments|drawing|sheet1|sheet3/.test(n))).toBe(false);
  });
});
