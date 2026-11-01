// Designed tables (specs/006): a design becomes an ordinary spec, and the generator turns it into
// values that respect what the person said. No data is read anywhere.

import { describe, expect, it } from "vitest";
import { defaultColumn, emptyDesign, uniqueName } from "../../src/lib/design/defaults";
import { apportion, bellQuantiles, evenQuantiles, meanOf, normalCdf, normalQuantile } from "../../src/lib/design/quantiles";
import { specFromDesign } from "../../src/lib/design/build";
import { parseDay, validateDesign } from "../../src/lib/design/validate";
import type { Design, DesignColumn } from "../../src/lib/design/types";
import { renderAll } from "../../src/lib/generate/render";
import { planTable } from "../../src/lib/generate/table";

const design = (columns: DesignColumn[], rows = 2000): Design => ({ ...emptyDesign(), rows, columns });

function generate(d: Design): string[][] {
  const result = specFromDesign(d);
  if (!result.ok) throw new Error(result.problems.map((p) => p.message).join("; "));
  const text = new TextDecoder().decode(renderAll(planTable(result.spec, result.spec.seed)));
  return text
    .trimEnd()
    .split("\n")
    .map((line) => line.split(","));
}

describe("the normal curve helpers", () => {
  it("invert each other", () => {
    for (const p of [0.001, 0.025, 0.2, 0.5, 0.8, 0.975, 0.999]) expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 5);
  });

  it("apportions whole numbers that add up exactly", () => {
    expect(apportion([50, 30, 20], 10)).toEqual([5, 3, 2]);
    expect(apportion([1, 1, 1], 10).reduce((a, b) => a + b, 0)).toBe(10);
    expect(apportion([0, 0], 5)).toEqual([0, 0]);
  });

  it("builds 101 ordered values that stay inside the range, centred where asked", () => {
    const q = bellQuantiles(18, 90, 40, 12);
    expect(q).toHaveLength(101);
    expect(q[0]).toBe(18);
    expect(q[100]).toBe(90);
    for (let i = 1; i < 101; i++) expect(q[i]).toBeGreaterThanOrEqual(q[i - 1]);
    expect(Math.abs(meanOf(q) - 40)).toBeLessThan(2);
    expect(evenQuantiles(0, 10)[50]).toBe(5);
  });
});

describe("validating a design", () => {
  it("accepts a fresh column of every kind", () => {
    const kinds = ["integer", "decimal", "category", "yesno", "date", "datetime", "id", "personal", "text"] as const;
    const columns: DesignColumn[] = [];
    for (const k of kinds) columns.push(defaultColumn(k, columns.map((c) => c.name)));
    expect(validateDesign(design(columns))).toEqual([]);
  });

  it("says what is wrong, field by field", () => {
    const a = defaultColumn("integer", []);
    const b = { ...defaultColumn("integer", []), name: a.name };
    if (a.kind !== "integer") throw new Error();
    const bad: DesignColumn[] = [{ ...a, min: 10, max: 5 }, b, { ...defaultColumn("category", ["x"]), labels: [] }];
    const problems = validateDesign(design(bad));
    expect(problems.find((p) => p.field === "max")?.message).toMatch(/more than the smallest/);
    expect(problems.filter((p) => p.field === "name").length).toBe(2); // both columns with the same name
    expect(problems.find((p) => p.field === "labels")?.message).toMatch(/at least one label/);
  });

  it("names a table that a file cannot be called", () => {
    expect(validateDesign({ ...design([]), tableName: "a/b" }).map((p) => p.field)).toContain("tableName");
    expect(validateDesign({ ...design([]), rows: 0 }).map((p) => p.field)).toContain("rows");
  });

  it("tells when an ID has too few digits for the rows", () => {
    const id = { ...defaultColumn("id", []), digits: 2 };
    expect(validateDesign(design([id], 1000)).find((p) => p.field === "digits")?.message).toMatch(/Add digits/);
  });

  it("reads days and refuses rollovers", () => {
    expect(parseDay("2024-02-29")).not.toBeNull();
    expect(parseDay("2023-02-29")).toBeNull();
    expect(parseDay("31/03/2024")).toBeNull();
  });

  it("needs a column before it becomes a spec", () => {
    const r = specFromDesign(design([]));
    expect(r.ok).toBe(false);
  });

  it("numbers repeated names", () => {
    expect(uniqueName("count", ["count", "count_2"])).toBe("count_3");
  });
});

describe("generating from a design", () => {
  it("writes a header and the asked number of rows, in the order of the columns", () => {
    const a = { ...defaultColumn("integer", []), name: "age" };
    const b = { ...defaultColumn("category", ["age"]), name: "mode" };
    const rows = generate(design([a, b], 500));
    expect(rows[0]).toEqual(["age", "mode"]);
    expect(rows).toHaveLength(501);
  });

  it("keeps whole numbers inside their range and centres a bell on the typical value", () => {
    const col = { ...defaultColumn("integer", []), name: "age", min: 18, max: 90, shape: "bell" as const, typical: 40, spread: 10 };
    const values = generate(design([col], 4000)).slice(1).map((r) => Number(r[0]));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(18);
    expect(Math.max(...values)).toBeLessThanOrEqual(90);
    expect(values.every(Number.isInteger)).toBe(true);
    expect(Math.abs(values.reduce((a, b) => a + b, 0) / values.length - 40)).toBeLessThan(1.5);
  });

  it("spreads an even number across its range", () => {
    const col = { ...defaultColumn("decimal", []), name: "fare", min: 0, max: 10, decimals: 2 };
    const values = generate(design([col], 4000)).slice(1).map((r) => Number(r[0]));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(10);
    expect(Math.abs(values.reduce((a, b) => a + b, 0) / values.length - 5)).toBeLessThan(0.3);
    expect(values.every((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6)).toBe(true);
  });

  it("gives each category its share", () => {
    const col = { ...defaultColumn("category", []), name: "mode", labels: [{ label: "Bus", weight: 50 }, { label: "Rail", weight: 30 }, { label: "Walk", weight: 20 }] };
    const values = generate(design([col], 1000)).slice(1).map((r) => r[0]);
    expect(values.filter((v) => v === "Bus")).toHaveLength(500);
    expect(values.filter((v) => v === "Rail")).toHaveLength(300);
    expect(values.filter((v) => v === "Walk")).toHaveLength(200);
  });

  it("leaves the asked share of cells blank", () => {
    const col = { ...defaultColumn("integer", []), name: "x", missingPct: 5 };
    const other = { ...defaultColumn("integer", ["x"]), name: "y" }; // a one-column table writes a blank as "" to keep the line
    const values = generate(design([col, other], 2000)).slice(1).map((r) => r[0]);
    expect(values.filter((v) => v === "")).toHaveLength(100);
  });

  it("keeps dates between the first and the last day, in the chosen format", () => {
    const col = { ...defaultColumn("date", []), name: "when", start: "2023-01-01", end: "2023-03-31", format: "%m/%d/%Y" };
    const values = generate(design([col], 800)).slice(1).map((r) => r[0]);
    for (const v of values) {
      const [m, d, y] = v.split("/").map(Number);
      const t = Date.UTC(y, m - 1, d);
      expect(t).toBeGreaterThanOrEqual(Date.UTC(2023, 0, 1));
      expect(t).toBeLessThanOrEqual(Date.UTC(2023, 2, 31));
    }
  });

  it("gives every row its own ID with the prefix", () => {
    const col = { ...defaultColumn("id", []), name: "pid", prefix: "P", digits: 5 };
    const values = generate(design([col], 3000)).slice(1).map((r) => r[0]);
    expect(new Set(values).size).toBe(3000);
    expect(values.every((v) => /^P\d{5}$/.test(v))).toBe(true);
  });

  it("invents personal details, a yes-or-no column and text of the asked length", () => {
    const cols: DesignColumn[] = [
      { ...defaultColumn("personal", []), name: "who" },
      { ...defaultColumn("yesno", ["who"]), name: "ok", yesPct: 25 },
      { ...defaultColumn("text", ["who", "ok"]), name: "notes", minLength: 10, maxLength: 30 },
    ];
    const rows = generate(design(cols, 400)).slice(1);
    expect(rows.every((r) => r[0].length > 0)).toBe(true);
    expect(rows.filter((r) => r[1] === "Yes")).toHaveLength(100);
    for (const r of rows) {
      expect(r[2].length).toBeGreaterThanOrEqual(10);
      expect(r[2].length).toBeLessThanOrEqual(30);
    }
  });

  it("gives the same file for the same seed, and a different one for another", () => {
    const d = design([{ ...defaultColumn("integer", []), name: "x" }], 300);
    expect(generate(d)).toEqual(generate({ ...d }));
    expect(generate({ ...d, seed: 7 })).not.toEqual(generate(d));
  });
});
