import { describe, expect, it } from "vitest";
import { createColumnGen } from "../../src/lib/generate/column";
import { CheckAccumulator } from "../../src/lib/generate/checks";
import { makePlacer } from "../../src/lib/generate/placement";
import { renderAll } from "../../src/lib/generate/render";
import { planTable, rowValues } from "../../src/lib/generate/table";
import { parseDate, patternKind, toNumber } from "../../src/lib/datefmt/directives";
import { SPEC_VERSION, type ColumnSpec, type SpecFile } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";

const N = 10_000;
const quantiles = Array.from({ length: 101 }, (_, i) => (i / 100) ** 2 * 100); // skewed: median 25

function spec(columns: ColumnSpec[], over: Partial<SpecFile> = {}): SpecFile {
  return {
    spec_version: SPEC_VERSION,
    source: { format: "csv", file_name: "t.csv", encoding: "utf-8", delimiter: ",", quote: '"', header: true },
    n_rows: N,
    seed: 42,
    columns,
    ...over,
  };
}

const column = (c: ColumnSpec, seed = 42, n = N) => {
  const gen = createColumnGen(c, { seed, nRows: n });
  return Array.from({ length: n }, (_, r) => gen.valueAt(r));
};
const tally = (values: string[]) => {
  const t: Record<string, number> = {};
  for (const v of values) t[v] = (t[v] ?? 0) + 1;
  return t;
};

const mode: ColumnSpec = {
  name: "mode",
  type: "categorical",
  storage: "integer",
  counts: { "1": 5000, "2": 2500, "3": 1500, "97": 800 },
  na: { tokens: ["", "NA"], count: 200, by_token: { "": 120, NA: 80 } },
  sentinels: { "-9": 100 },
};
// 5000 + 2500 + 1500 + 800 = 9800 values; 200 NA; plus 100 sentinels would exceed 10,000 rows.
const modeFixed: ColumnSpec = { ...mode, counts: { "1": 5000, "2": 2500, "3": 1500, "97": 700 } };

describe("placement of NA and sentinels", () => {
  it("hits every count exactly and covers every row once", () => {
    const place = makePlacer(1000, 7, { tokens: ["", "NA"], count: 50, by_token: { "": 30, NA: 20 } }, { "-9": 10, "998": 5 });
    const seen = new Map<string, number>();
    const valueIndexes = new Set<number>();
    for (let r = 0; r < 1000; r++) {
      const p = place(r);
      const key = p.kind === "value" ? "value" : `${p.kind}:${p.token}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
      if (p.kind === "value") valueIndexes.add(p.index);
    }
    expect(Object.fromEntries(seen)).toEqual({ "na:": 30, "na:NA": 20, "sentinel:-9": 10, "sentinel:998": 5, value: 935 });
    expect(valueIndexes.size).toBe(935);
    expect(Math.min(...valueIndexes)).toBe(0);
    expect(Math.max(...valueIndexes)).toBe(934);
  });

  it("puts NA at scattered rows, not in one block", () => {
    const place = makePlacer(1000, 3, { tokens: [""], count: 100 }, {});
    const naRows = Array.from({ length: 1000 }, (_, r) => r).filter((r) => place(r).kind === "na");
    expect(naRows.length).toBe(100);
    expect(naRows[naRows.length - 1] - naRows[0]).toBeGreaterThan(700);
  });

  it("rejects counts that exceed the rows", () => {
    expect(() => makePlacer(10, 1, { tokens: [""], count: 8 }, { "-9": 5 })).toThrow(RangeError);
  });
});

describe("categorical columns hit every count exactly", () => {
  const values = column(modeFixed);

  it("keeps exact label counts, NA counts per token and sentinel counts", () => {
    expect(tally(values)).toEqual({ "1": 5000, "2": 2500, "3": 1500, "97": 700, "": 120, NA: 80, "-9": 100 });
  });

  it("shuffles labels instead of writing them in blocks", () => {
    const firstThousand = tally(values.slice(0, 1000));
    expect(Object.keys(firstThousand).length).toBeGreaterThanOrEqual(5);
  });

  it("works for boolean columns with their original tokens", () => {
    const flag: ColumnSpec = { name: "flag", type: "boolean", storage: "string", counts: { Y: 6000, N: 4000 } };
    expect(tally(column(flag))).toEqual({ Y: 6000, N: 4000 });
  });

  it("uses an empty-string NA token when no token is recorded", () => {
    const c: ColumnSpec = { name: "c", type: "categorical", counts: { a: 90 }, na: { tokens: [""], count: 10 } };
    expect(tally(column(c, 1, 100))).toEqual({ a: 90, "": 10 });
  });

  it("fails clearly when counts do not match the rows", () => {
    const bad: ColumnSpec = { name: "x", type: "categorical", counts: { a: 5 } };
    expect(() => createColumnGen(bad, { seed: 1, nRows: 10 })).toThrow(/do not match/);
  });
});

describe("numeric columns always include the exact min and max", () => {
  const base = { name: "x", min: 0.05, max: 87.4, mean: 6.83, sd: 8.91, decimals: 2, quantiles };

  it.each(["uniform", "match_mean_sd", "match_shape"] as const)("in %s mode", (m) => {
    const c: ColumnSpec = { ...base, type: "float", mode: m, na: { tokens: [""], count: 300 }, sentinels: { "-9.99": 50 } };
    const values = column(c).filter((v) => v !== "" && v !== "-9.99");
    const nums = values.map(Number);
    expect(Math.min(...nums)).toBe(0.05);
    expect(Math.max(...nums)).toBe(87.4);
    expect(nums.filter((x) => x === 0.05).length).toBeGreaterThanOrEqual(1);
    expect(values.every((v) => /^\d+\.\d{2}$/.test(v))).toBe(true); // fixed decimals kept
  });

  it("match_mean_sd hits the mean and sd closely", () => {
    const c: ColumnSpec = { ...base, type: "float", mode: "match_mean_sd" };
    const nums = column(c).map(Number);
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const sd = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length);
    expect(mean).toBeGreaterThan(6.83 * 0.93);
    expect(mean).toBeLessThan(6.83 * 1.07);
    expect(sd).toBeGreaterThan(8.91 * 0.9);
    expect(sd).toBeLessThan(8.91 * 1.1);
  });

  it("match_shape keeps the skew (median far below the midpoint)", () => {
    const c: ColumnSpec = { ...base, type: "float", mode: "match_shape", min: 0, max: 100, quantiles };
    const nums = column(c).map(Number).sort((a, b) => a - b);
    expect(nums[N / 2]).toBeGreaterThan(20);
    expect(nums[N / 2]).toBeLessThan(30); // true median is 25
  });

  it("writes integers without decimals and with the thousands separators the source used", () => {
    const c: ColumnSpec = { name: "pop", type: "integer", mode: "uniform", min: 1000, max: 2_000_000, thousands: true };
    const values = column(c);
    expect(values.every((v) => /^\d{1,3}(,\d{3})+$/.test(v))).toBe(true);
    expect(values).toContain("1,000");
    expect(values).toContain("2,000,000");
  });

  it("never writes negative zero", () => {
    const c: ColumnSpec = { name: "z", type: "float", mode: "uniform", min: -0.001, max: 0.001, decimals: 2 };
    expect(column(c).some((v) => v.startsWith("-0"))).toBe(false);
  });

  it("returns the single value of a constant column", () => {
    const c: ColumnSpec = { name: "k", type: "float", mode: "uniform", min: 3.14, max: 3.14, decimals: 2 };
    expect(new Set(column(c))).toEqual(new Set(["3.14"]));
  });

  it("falls back to uniform when no beta can fit the mean and sd", () => {
    const c: ColumnSpec = { name: "u", type: "integer", mode: "match_mean_sd", min: 0, max: 10, mean: 5, sd: 50 };
    const nums = column(c).map(Number);
    expect(Math.min(...nums)).toBe(0);
    expect(Math.max(...nums)).toBe(10);
  });
});

describe("date, datetime and time columns keep their format and range", () => {
  const range = (kind: "date" | "datetime" | "time", pattern: string, min: number, max: number, granularity: "day" | "minute" | "second"): ColumnSpec => ({
    name: "when",
    type: kind,
    mode: "uniform",
    min,
    max,
    format: pattern,
    granularity,
  });
  const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);

  it("writes dates in the original pattern, within the real range", () => {
    const c = range("date", "%m/%d/%Y", day("2015-01-05"), day("2024-12-28"), "day");
    const values = column(c);
    expect(values.every((v) => /^\d{2}\/\d{2}\/\d{4}$/.test(v))).toBe(true);
    const days = values.map((v) => toNumber(parseDate(v, "%m/%d/%Y")!, "date"));
    expect(Math.min(...days)).toBe(day("2015-01-05"));
    expect(Math.max(...days)).toBe(day("2024-12-28"));
  });

  it("keeps minute granularity for times", () => {
    const c = range("time", "%H:%M", 5 * 60, 23 * 3600 + 59 * 60, "minute");
    const values = column(c);
    expect(values.every((v) => /^\d{2}:\d{2}$/.test(v))).toBe(true);
    const secs = values.map((v) => toNumber(parseDate(v, "%H:%M")!, patternKind("%H:%M")));
    expect(Math.min(...secs)).toBe(300);
    expect(Math.max(...secs)).toBe(23 * 3600 + 59 * 60);
  });

  it("writes twelve-hour datetimes and the compact %H%M form", () => {
    const c = range("datetime", "%m/%d/%Y %I:%M:%S %p", 1_500_000_000, 1_700_000_000, "second");
    expect(column(c).every((v) => /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} (AM|PM)$/.test(v))).toBe(true);
    const t = range("time", "%H%M", 0, 86340, "minute");
    expect(column(t).every((v) => /^\d{4}$/.test(v))).toBe(true);
  });

  it("keeps the sentinel and NA tokens a time column used", () => {
    const c: ColumnSpec = { ...range("time", "%H%M", 0, 86340, "minute"), na: { tokens: ["NA"], count: 100 }, sentinels: { "-9": 50 } };
    const t = tally(column(c));
    expect(t.NA).toBe(100);
    expect(t["-9"]).toBe(50);
  });
});

describe("determinism and independence between columns (FR-020, FR-021)", () => {
  const a: ColumnSpec = { name: "a", type: "integer", mode: "uniform", min: 0, max: 1000 };
  const b: ColumnSpec = { name: "b", type: "float", mode: "match_mean_sd", min: 0, max: 100, mean: 30, sd: 15, decimals: 1 };

  it("gives identical output for the same seed", () => {
    expect(column(a)).toEqual(column(a));
  });

  it("gives different output for a different seed", () => {
    expect(column(a, 42)).not.toEqual(column(a, 43));
  });

  it("does not change a column when another column's settings change", () => {
    const before = renderAll(planTable(spec([a, b])));
    const changed = renderAll(planTable(spec([a, { ...b, mean: 60, sd: 10, mode: "match_mean_sd" }])));
    expect(before).not.toEqual(changed);
    const colA = (plan: ReturnType<typeof planTable>) => Array.from({ length: 200 }, (_, r) => rowValues(plan, r)[0]);
    expect(colA(planTable(spec([a, b])))).toEqual(colA(planTable(spec([a, { ...b, mean: 60, sd: 10 }]))));
  });

  it("does not depend on column position or on which other columns exist", () => {
    const alone = column(a);
    const plan = planTable(spec([b, a]));
    const inTable = Array.from({ length: N }, (_, r) => rowValues(plan, r)[1]);
    expect(inTable).toEqual(alone);
  });

  it("produces identical bytes whatever the chunk size", () => {
    // A column sized for 2,500 rows: 2300 labels + 100 NA + 100 sentinels.
    const small: ColumnSpec = {
      ...mode,
      counts: { "1": 1250, "2": 625, "3": 375, "97": 50 },
      na: { tokens: ["", "NA"], count: 100, by_token: { "": 60, NA: 40 } },
      sentinels: { "-9": 100 },
    };
    const s = spec([small, a, b], { n_rows: 2500 });
    const tiny = renderAll(planTable(s), 7);
    const huge = renderAll(planTable(s), 100000);
    expect(tiny).toEqual(huge);
  });
});

describe("excluded columns", () => {
  const cols: ColumnSpec[] = [
    { name: "keep", type: "integer", mode: "uniform", min: 0, max: 9 },
    { name: "gone", type: "integer", mode: "uniform", min: 0, max: 9, exclude: "drop" },
    { name: "blank", type: "unsupported", exclude: "keep_as_na" },
    { name: "email", type: "unsupported", exclude: "drop" },
  ];

  it("drops columns by default and keeps the rest in order", () => {
    const plan = planTable(spec(cols, { n_rows: 5 }));
    expect(plan.header).toEqual(["keep", "blank"]);
  });

  it("writes kept-as-NA columns as all NA", () => {
    const plan = planTable(spec(cols, { n_rows: 50 }));
    expect(new Set(Array.from({ length: 50 }, (_, r) => rowValues(plan, r)[1]))).toEqual(new Set([""]));
  });

  it("uses a renamed column's output name in the header", () => {
    const plan = planTable(spec([{ name: "mode", output_name: "travel_mode", type: "integer", mode: "uniform", min: 0, max: 9 }], { n_rows: 3 }));
    expect(plan.header).toEqual(["travel_mode"]);
  });
});

describe("label protections", () => {
  it("merges rare labels into Other and keeps the total", () => {
    const c: ColumnSpec = { name: "c", type: "categorical", counts: { a: 900, b: 60, c: 30, d: 10 }, merge_under_k: 100 };
    expect(tally(column(c, 1, 1000))).toEqual({ a: 900, Other: 100 });
  });

  it("replaces labels with neutral codes", () => {
    const c: ColumnSpec = { name: "c", type: "categorical", counts: { Walk: 600, Bike: 400 }, label_codes: true };
    expect(tally(column(c, 1, 1000))).toEqual({ cat_01: 600, cat_02: 400 });
  });
});

describe("the check table", () => {
  it("passes every exact metric for a generated table", () => {
    const cols: ColumnSpec[] = [
      modeFixed,
      { name: "dist", type: "float", mode: "match_mean_sd", min: 0.05, max: 87.4, mean: 6.83, sd: 8.91, decimals: 2, na: { tokens: [""], count: 250 }, sentinels: { "-9": 120 } },
      { name: "when", type: "date", mode: "uniform", min: 16000, max: 19999, format: "%Y-%m-%d", granularity: "day" },
    ];
    const s = spec(cols);
    expect(validateSpec(s).ok).toBe(true);
    const plan = planTable(s);
    const acc = new CheckAccumulator(plan);
    for (let r = 0; r < plan.nRows; r++) acc.observeRow(rowValues(plan, r));
    const checks = acc.finish();
    expect(checks.length).toBeGreaterThan(8);
    expect(checks.filter((c) => !c.pass)).toEqual([]);
    expect(checks.map((c) => `${c.column}.${c.metric}`)).toEqual(
      expect.arrayContaining(["mode.label_counts", "mode.na_count", "mode.sentinel_counts", "dist.min", "dist.max", "dist.mean", "dist.sd", "when.min", "when.max"]),
    );
  });

  it("reports a failure when the output does not match its target", () => {
    const plan = planTable(spec([{ name: "mode", type: "categorical", counts: { a: 60, b: 40 } }], { n_rows: 100 }));
    const acc = new CheckAccumulator(plan);
    for (let r = 0; r < 100; r++) acc.observeRow(rowValues(plan, r).map(() => "a")); // wrong on purpose
    expect(acc.finish().some((c) => !c.pass)).toBe(true);
  });
});
