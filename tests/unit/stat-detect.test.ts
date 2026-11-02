// Telling SPSS and Stata files from their first bytes (specs/017 FR-001).
import { describe, expect, it } from "vitest";
import { csvNameOf, detectStat, WRITABLE_FORMATS } from "../../src/lib/stat/detect";

const bytes = (text: string, pad = 16) =>
  Uint8Array.from(
    [...text].map((c) => c.charCodeAt(0)).concat(new Array(Math.max(0, pad - text.length)).fill(0)),
  );

describe("detectStat", () => {
  it("knows SPSS by its signature, whatever the name", () => {
    expect(detectStat(bytes("$FL2@(#) SPSS"), "a.bin")).toBe("sav");
    expect(detectStat(bytes("$FL3"), "a.zsav")).toBe("sav");
  });
  it("knows Stata 13 and later by its tag", () => {
    expect(detectStat(bytes("<stata_dta><header>"), "a.dta")).toBe("dta");
  });
  it("knows older Stata files only when the name says .dta", () => {
    expect(detectStat(Uint8Array.from([114, 2, 1, 0, 0, 0, 0, 0]), "old.dta")).toBe("dta");
    expect(detectStat(Uint8Array.from([114, 2, 1, 0, 0, 0, 0, 0]), "old.txt")).toBeNull();
  });
  it("knows SAS data sets by their signature and transport files by their first record", () => {
    const sas = new Uint8Array(64);
    sas.set([0xc2, 0xea, 0x81, 0x60, 0xb3, 0x14, 0x11, 0xcf, 0xbd, 0x92, 0x08, 0x00, 0x09, 0xc7, 0x31, 0x8c], 12);
    expect(detectStat(sas, "a.bin")).toBe("sas7bdat");
    expect(detectStat(bytes("HEADER RECORD*******LIBRARY HEADER RECORD!!!!!!!", 64), "a.xpt")).toBe("xpt");
    expect(detectStat(bytes("HEADER RECORD*******LIBV8   HEADER RECORD!!!!!!!", 64), "a.xpt")).toBe("xpt");
  });
  it("SPSS, Stata and SAS transport can be written back; a SAS data set cannot", () => {
    expect(WRITABLE_FORMATS).toEqual(["sav", "dta", "xpt"]);
  });
  it("does not take text for either", () => {
    expect(detectStat(bytes("a,b,c\n1,2,3"), "t.dta")).toBeNull();
    expect(detectStat(bytes("a,b"), "t.csv")).toBeNull();
  });
  it("names the table as a CSV", () => {
    expect(csvNameOf("Survey 2024.sav")).toBe("Survey 2024.csv");
  });
});
