// Column letters, cell ranges and sheet names (specs/003 FR-001, FR-002, FR-011).

import { describe, expect, it } from "vitest";
import { cellRef, columnIndex, columnLetters, formatRange, isValidSheetName, parseRange } from "../../src/lib/xlsx/names";

describe("column letters", () => {
  it.each([
    [0, "A"],
    [1, "B"],
    [25, "Z"],
    [26, "AA"],
    [27, "AB"],
    [51, "AZ"],
    [52, "BA"],
    [701, "ZZ"],
    [702, "AAA"],
    [16383, "XFD"],
  ])("index %i is %s", (index, letters) => {
    expect(columnLetters(index)).toBe(letters);
    expect(columnIndex(letters)).toBe(index);
  });

  it("reads lower case and refuses what is not a column", () => {
    expect(columnIndex("ab")).toBe(27);
    expect(() => columnIndex("")).toThrow();
    expect(() => columnIndex("A1")).toThrow();
    expect(() => columnIndex("XFE")).toThrow(); // one past the last column
  });

  it("round trips every column", () => {
    for (let i = 0; i < 16384; i += 37) expect(columnIndex(columnLetters(i))).toBe(i);
  });
});

describe("cell references and ranges", () => {
  it("writes a cell reference from zero-based column and row", () => {
    expect(cellRef(0, 0)).toBe("A1");
    expect(cellRef(26, 9)).toBe("AA10");
  });

  it("parses a range", () => {
    expect(parseRange("A3:I203")).toEqual({ firstCol: 0, firstRow: 2, lastCol: 8, lastRow: 202 });
    expect(parseRange("aa10:ab12")).toEqual({ firstCol: 26, firstRow: 9, lastCol: 27, lastRow: 11 });
    expect(parseRange("$B$2:$D$5")).toEqual({ firstCol: 1, firstRow: 1, lastCol: 3, lastRow: 4 });
  });

  it("reads a single cell as a range of one", () => {
    expect(parseRange("C4")).toEqual({ firstCol: 2, firstRow: 3, lastCol: 2, lastRow: 3 });
  });

  it("refuses an invalid or backwards range", () => {
    for (const bad of ["", "A", "3:5", "A0:B2", "B2:A1", "A1:B", "A1:B2:C3", "A1048577:A1048577", "XFE1:XFE2", "A1;B2"]) expect(parseRange(bad), bad).toBeNull();
  });

  it("formats a range and round trips", () => {
    const r = { firstCol: 0, firstRow: 2, lastCol: 8, lastRow: 202 };
    expect(formatRange(r)).toBe("A3:I203");
    expect(parseRange(formatRange(r))).toEqual(r);
  });
});

describe("sheet names", () => {
  it.each(["Data", "Survey Data", "Résumé", "2024 totals", "A", "x".repeat(31), "it's fine"])("accepts %s", (name) => {
    expect(isValidSheetName(name)).toBe(true);
  });

  it.each(["", " ", "x".repeat(32), "a/b", "a\\b", "a?b", "a*b", "a:b", "a[b", "a]b", "'quoted", "quoted'"])("refuses %j", (name) => {
    expect(isValidSheetName(name)).toBe(false);
  });
});
