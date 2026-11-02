import { describe, expect, it } from "vitest";
import { defaultColumn } from "../../src/lib/design/defaults";
import { describeColumn } from "../../src/lib/design/summary";
import type { DesignColumn } from "../../src/lib/design/types";

const col = <K extends Parameters<typeof defaultColumn>[0]>(kind: K, over: Record<string, unknown> = {}) => ({ ...defaultColumn(kind), ...over }) as DesignColumn;

describe("describeColumn", () => {
  it("says the range and the shape of a number", () => {
    expect(describeColumn(col("integer", { min: 18, max: 90 }))).toBe("18 to 90, even");
    expect(describeColumn(col("integer", { min: 18, max: 90, shape: "bell", typical: 40 }))).toBe("18 to 90, around 40");
    expect(describeColumn(col("decimal", { min: 0, max: 1, decimals: 2 }))).toBe("0 to 1, 2 decimals, even");
  });

  it("counts labels, and gives the shares of a yes or no", () => {
    expect(describeColumn(col("category", { labels: [{ label: "a", weight: 1 }, { label: "b", weight: 2 }] }))).toBe("2 labels");
    expect(describeColumn(col("yesno", { yesPct: 30, yesLabel: "yes", noLabel: "no" }))).toBe("yes 30%, no 70%");
  });

  it("gives the days of a date, the shape of an ID, the kind of a personal detail and the length of a text", () => {
    expect(describeColumn(col("date", { start: "2023-01-01", end: "2023-03-31" }))).toBe("2023-01-01 to 2023-03-31");
    expect(describeColumn(col("id", { prefix: "P", digits: 4 }))).toBe("P9999");
    expect(describeColumn(col("personal", { personal: "full_name" }))).toBe("full name");
    expect(describeColumn(col("text", { minLength: 5, maxLength: 40 }))).toBe("5 to 40 characters");
  });
});
