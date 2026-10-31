// Generating personal identifier columns (specs/002 FR-002 to FR-004, FR-011, FR-012): the same distinct
// count and repeat structure as the real column, exact NA and sentinel counts, output that does not
// depend on chunk size, and check rows that pass.

import { describe, expect, it } from "vitest";
import { CheckAccumulator } from "../../src/lib/generate/checks";
import { GenerationError } from "../../src/lib/generate/column";
import { renderAll } from "../../src/lib/generate/render";
import { planTable, rowValues } from "../../src/lib/generate/table";
import { SPEC_VERSION, type ColumnSpec, type SpecFile } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";

const N = 6000;

const spec = (columns: ColumnSpec[], over: Partial<SpecFile> = {}): SpecFile => ({
  spec_version: SPEC_VERSION,
  source: { format: "csv", file_name: "t.csv", encoding: "utf-8", delimiter: ",", quote: '"', header: true },
  n_rows: N,
  seed: 11,
  columns,
  ...over,
});

const who: ColumnSpec = {
  name: "who",
  type: "personal",
  kind: "full_name",
  repeat_structure: { "1": 3000, "2": 800, "3": 300, "10": 50 },
  na: { tokens: ["", "NA"], count: 100, by_token: { "": 60, NA: 40 } },
  sentinels: { Refused: 100 },
};
// 3000 + 1600 + 900 + 500 = 6000 rows, minus 200 NA and sentinel rows
const whoRows = { ...who, repeat_structure: { "1": 3000 - 200, "2": 800, "3": 300, "10": 50 } } as ColumnSpec;

const column = (c: ColumnSpec, name = c.name) => {
  const s = spec([c]);
  const plan = planTable(s);
  return Array.from({ length: N }, (_, r) => rowValues(plan, r)[plan.columns.findIndex((x) => x.spec.name === name)]);
};

const repeatOf = (values: string[]) => {
  const per = new Map<string, number>();
  for (const v of values) per.set(v, (per.get(v) ?? 0) + 1);
  const structure: Record<string, number> = {};
  for (const n of per.values()) structure[n] = (structure[n] ?? 0) + 1;
  return structure;
};

describe("the spec used here is valid", () => {
  it("passes validation", () => {
    const r = validateSpec(spec([whoRows]));
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    expect(r.ok).toBe(true);
  });
});

describe("a personal column keeps its counts", () => {
  const values = column(whoRows);
  const real = values.filter((v) => v !== "" && v !== "NA" && v !== "Refused");

  it("has the exact NA and sentinel counts", () => {
    expect(values.filter((v) => v === "").length).toBe(60);
    expect(values.filter((v) => v === "NA").length).toBe(40);
    expect(values.filter((v) => v === "Refused").length).toBe(100);
  });

  it("has exactly the repeat structure and distinct count of the real column", () => {
    expect(repeatOf(real)).toEqual({ "1": 2800, "2": 800, "3": 300, "10": 50 });
    expect(new Set(real).size).toBe(2800 + 800 + 300 + 50);
  });

  it("writes invented full names", () => {
    for (const v of real.slice(0, 200)) expect(v).toMatch(/^\S+( [A-Z]\.)? \S+/);
  });
});

describe("every kind generates with the right distinct count", () => {
  const kinds = ["full_name", "first_name", "last_name", "email", "phone", "address", "url", "ip"] as const;
  it.each(kinds)("%s", (kind) => {
    const col: ColumnSpec = { name: "c", type: "personal", kind, repeat_structure: { "1": 4500, "3": 500 } };
    const values = column(col);
    expect(new Set(values).size).toBe(5000);
    expect(repeatOf(values)).toEqual({ "1": 4500, "3": 500 });
  });

  it("first names past their natural space get a number, and stay distinct", () => {
    const col: ColumnSpec = { name: "c", type: "personal", kind: "first_name", repeat_structure: { "1": N } };
    const values = column(col);
    expect(new Set(values).size).toBe(N);
    expect(values.some((v) => /\d$/.test(v))).toBe(true); // 6000 first names need more than the list holds
  });

  it("refuses a kind with no room for a suffix when more values are needed than exist", () => {
    // 100 million SSN-style numbers cannot all be invented; the generator says so instead of repeating.
    const col: ColumnSpec = { name: "c", type: "personal", kind: "ssn", acknowledged: true, repeat_structure: { "1": N } };
    expect(() => column(col)).not.toThrow(); // N is far below the natural space
    const big = { ...col, repeat_structure: { "1": 100_000_000 } } as ColumnSpec;
    expect(() => planTable(spec([big], { n_rows: 100_000_000 }))).toThrow(GenerationError);
  });
});

describe("determinism", () => {
  const s = spec([whoRows, { name: "mail", type: "personal", kind: "email", repeat_structure: { "1": N } }]);
  const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

  it("gives identical bytes whatever the chunk size", () => {
    const reference = renderAll(planTable(s), 5000);
    for (const chunk of [1, 13, 999, 6000]) expect(same(renderAll(planTable(s), chunk), reference)).toBe(true);
  });

  it("changes with the seed and with nothing else", () => {
    expect(same(renderAll(planTable(s, 1)), renderAll(planTable(s, 2)))).toBe(false);
    expect(same(renderAll(planTable(s, 1)), renderAll(planTable(s, 1)))).toBe(true);
  });

  it("changing one column changes no other", () => {
    const base = planTable(s);
    const other = planTable({ ...s, columns: [{ ...whoRows, kind: "last_name" } as ColumnSpec, s.columns[1]] });
    for (const r of [0, 17, 4000]) expect(rowValues(base, r)[1]).toBe(rowValues(other, r)[1]);
  });
});

describe("the check table", () => {
  it("has distinct count, repeat structure, NA and sentinel rows that pass", () => {
    const plan = planTable(spec([whoRows]));
    const acc = new CheckAccumulator(plan);
    for (let r = 0; r < plan.nRows; r++) acc.observeRow(rowValues(plan, r));
    const checks = acc.finish();
    expect(checks.map((c) => c.metric).sort()).toEqual(["distinct_count", "na_count", "repeat_structure", "sentinel_counts"]);
    expect(checks.filter((c) => !c.pass)).toEqual([]);
  });

  it("fails when the distinct count is wrong", () => {
    const plan = planTable(spec([whoRows]));
    const acc = new CheckAccumulator(plan);
    for (let r = 0; r < plan.nRows; r++) acc.observeRow(["Same Person"]);
    expect(acc.finish().some((c) => c.metric === "distinct_count" && !c.pass)).toBe(true);
  });
});
