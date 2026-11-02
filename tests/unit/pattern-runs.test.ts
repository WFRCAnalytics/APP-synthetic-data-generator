// A pattern as runs (PatternRuns): neighbouring positions of one kind join, fixed characters join into the text they spell.
import { describe, expect, it } from "vitest";
import { runsOf } from "../../src/features/review/runLogic";
import type { MaskToken } from "../../src/lib/profile/types";

describe("runsOf", () => {
  it("joins neighbouring positions of the same kind", () => {
    expect(runsOf(["upper", "upper", "digit", "digit", "digit"])).toEqual([
      { from: 1, to: 2, kind: "upper", text: "" },
      { from: 3, to: 5, kind: "digit", text: "" },
    ]);
  });

  it("joins fixed characters into the text they spell", () => {
    expect(runsOf([{ literal: "R" }, { literal: "E" }, { literal: "F" }, "digit", { literal: "-" }])).toEqual([
      { from: 1, to: 3, kind: "literal", text: "REF" },
      { from: 4, to: 4, kind: "digit", text: "" },
      { from: 5, to: 5, kind: "literal", text: "-" },
    ]);
  });

  it("makes a long pattern a handful of runs", () => {
    const tokens: MaskToken[] = ["lower", "lower", "digit", ...Array.from({ length: 11 }, () => "alnum" as const), "upper", "digit"];
    expect(runsOf(tokens)).toHaveLength(5);
    expect(runsOf([])).toEqual([]);
  });
});
