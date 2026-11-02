import { describe, expect, it } from "vitest";
import { reasonText } from "../../src/features/review/summary";
import { JSON_UNSUPPORTED_REASONS, JSON_UNSUPPORTED_TEXT } from "../../src/lib/json/types";
import { UNSUPPORTED_TEXT } from "../../src/lib/parquet/types";

describe("JSON reasons", () => {
  it("says in fixed words that a key mixing kinds is read as text", () => {
    expect(reasonText("mixed_kinds")).toMatch(/more than one kind of value/);
    expect(reasonText("mixed_kinds")).toMatch(/as text/);
  });

  it("has a fixed text for each nested kind, shared with the column card", () => {
    for (const reason of JSON_UNSUPPORTED_REASONS) {
      expect(JSON_UNSUPPORTED_TEXT[reason].length).toBeGreaterThan(20);
      expect(UNSUPPORTED_TEXT[reason]).toBe(JSON_UNSUPPORTED_TEXT[reason]);
    }
  });

  it("names only the kind, never a value", () => {
    for (const text of Object.values(JSON_UNSUPPORTED_TEXT)) expect(text).toMatch(/Objects|Lists/);
  });
});
