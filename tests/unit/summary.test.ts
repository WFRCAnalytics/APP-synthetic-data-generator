import { describe, expect, it } from "vitest";
import { reasonText, sparkBars, summaryLines, typeLabel } from "../../src/features/review/summary";
import type { ColumnProfile, ReasonCode } from "../../src/lib/profile/types";
import { categorical, dateColumn, numeric, unsupportedColumn } from "../helpers/fakeWorkers";

const withSummary = (p: ColumnProfile, summary: Partial<Extract<ColumnProfile["summary"], { kind: "numeric" }>>): ColumnProfile => ({
  ...p,
  summary: { ...(p.summary as Extract<ColumnProfile["summary"], { kind: "numeric" }>), ...summary },
});

describe("card text", () => {
  it("shows the range and the mean and spread of a number column", () => {
    const lines = summaryLines(numeric("x"));
    expect(lines[0]).toBe("Range 0.5 to 9.5");
    expect(lines[1]).toBe("Mean 4 · spread 2");
  });

  it("limits long decimals to six significant digits", () => {
    const p = withSummary(numeric("x"), { mean: 299.240235, sd: 174.335923 });
    expect(summaryLines(p)[1]).toBe("Mean 299.24 · spread 174.336");
  });

  it("separates thousands in whole numbers", () => {
    const p = withSummary(numeric("x"), { min: 1000, max: 2500000 });
    expect(summaryLines(p)[0]).toBe("Range 1,000 to 2,500,000");
  });

  it("lists the commonest labels of a categorical column, then dots", () => {
    const lines = summaryLines(categorical("mode"));
    expect(lines[0]).toBe("4 values");
    expect(lines[1]).toBe("1: 60 · 2: 30 · 3: 6 · …");
  });

  it("shows a blank label as (blank)", () => {
    const p = categorical("x", { summary: { kind: "categorical", storage: "string", counts: { "": 3 } } });
    expect(summaryLines(p)[1]).toBe("(blank): 3");
  });

  it("formats the range of a date in its own pattern", () => {
    const lines = summaryLines(dateColumn("when"));
    expect(lines[0]).toMatch(/^Range \d{2}\/\d{2}\/\d{4} to \d{2}\/\d{2}\/\d{4}$/);
    expect(lines[1]).toBe("Format %m/%d/%Y");
  });

  it("lists sentinel codes in numeric order, not object-key order", () => {
    const p = { ...numeric("x"), sentinels: { "998": 14, "999": 32, "-9": 49, "-1": 36 } };
    expect(summaryLines(p).find((l) => l.startsWith("Codes kept"))).toBe("Codes kept: -9 (49), -1 (36), 998 (14), 999 (32)");
  });

  it("mentions missing values only when there are some", () => {
    expect(summaryLines(numeric("x")).some((l) => l.startsWith("Missing"))).toBe(false);
    expect(summaryLines({ ...numeric("x"), naCount: 1234 }).some((l) => l === "Missing: 1,234")).toBe(true);
  });

  it("says a column is left out when it is unsupported", () => {
    expect(summaryLines(unsupportedColumn("email"))).toContain("Left out of the fake file");
  });
});

describe("chart data", () => {
  it("scales bars to the tallest", () => {
    expect(sparkBars(categorical("mode"))).toEqual([1, 0.5, 0.1, 4 / 60]);
  });

  it("uses the histogram for numbers and dates", () => {
    expect(sparkBars(numeric("x"))).toHaveLength(20);
    expect(sparkBars(dateColumn("when"))).toHaveLength(20);
    expect(Math.max(...sparkBars(numeric("x")))).toBe(1);
  });

  it("draws nothing for a column without a distribution", () => {
    expect(sparkBars(unsupportedColumn("email"))).toEqual([]);
  });

  it("caps a long list of categories at 24 bars", () => {
    const counts = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`L${i}`, 60 - i]));
    expect(sparkBars(categorical("x", { summary: { kind: "categorical", storage: "string", counts } }))).toHaveLength(24);
  });
});

describe("labels and reasons", () => {
  it("has a plain label for every type", () => {
    for (const t of ["empty", "boolean", "categorical", "integer", "float", "date", "datetime", "time", "survey_id", "unsupported"]) {
      expect(typeLabel(t).length).toBeGreaterThan(2);
    }
  });

  it("explains every reason code in a sentence", () => {
    const codes: ReasonCode[] = [
      "possible_identifier",
      "possible_sentinel",
      "near_categorical_threshold",
      "date_format_unrecognized",
      "date_format_mixed",
      "date_format_ambiguous",
      "id_mask_too_narrow",
      "id_mixed_masks",
      "possible_na_token",
      "id_not_yet_supported",
      "override_not_possible",
      "beta_fit_failed",
      "unsupported_type",
    ];
    for (const code of codes) expect(reasonText(code)).toMatch(/\.$/);
  });
});
