// Telling SPSS and Stata files from their first bytes (specs/017 FR-001).
import { describe, expect, it } from "vitest";
import { csvNameOf, detectStat } from "../../src/lib/stat/detect";

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
  it("does not take text for either", () => {
    expect(detectStat(bytes("a,b,c\n1,2,3"), "t.dta")).toBeNull();
    expect(detectStat(bytes("a,b"), "t.csv")).toBeNull();
  });
  it("names the table as a CSV", () => {
    expect(csvNameOf("Survey 2024.sav")).toBe("Survey 2024.csv");
  });
});
