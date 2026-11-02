// Rules between columns (specs/015): a rule the person states holds in every row, is checked on Generate, is kept in the spec,
// is refused when it does not fit the table, and leaves the other columns alone.

import { describe, expect, it } from "vitest";
import { CheckAccumulator } from "../../src/lib/generate/checks";
import { renderAll } from "../../src/lib/generate/render";
import { planTable, rowValues } from "../../src/lib/generate/table";
import { agentReadme } from "../../src/lib/readme/agentReadme";
import { describeRule, type RuleSpec } from "../../src/lib/rules/types";
import { buildSpec } from "../../src/lib/spec/build";
import { SPEC_VERSION, type ColumnSpec, type SpecFile } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";
import { parseDate } from "../../src/lib/datefmt/directives";

const N = 600;
const q = (lo: number, hi: number) =>
  Array.from({ length: 101 }, (_, i) => lo + ((hi - lo) * i) / 100);

const columns: ColumnSpec[] = [
  {
    name: "start",
    type: "date",
    mode: "uniform",
    min: 19000,
    max: 19300,
    format: "%Y-%m-%d",
    granularity: "day",
    na: { tokens: [""], count: 60 },
  },
  {
    name: "end",
    type: "date",
    mode: "uniform",
    min: 19000,
    max: 19300,
    format: "%Y-%m-%d",
    granularity: "day",
  },
  {
    name: "ts",
    type: "datetime",
    mode: "uniform",
    min: 1_650_000_000,
    max: 1_660_000_000,
    format: "%Y-%m-%d %H:%M:%S",
    granularity: "second",
  },
  {
    name: "ts_end",
    type: "datetime",
    mode: "uniform",
    min: 1_650_000_000,
    max: 1_660_000_000,
    format: "%Y-%m-%d %H:%M:%S",
    granularity: "second",
  },
  {
    name: "age",
    type: "integer",
    mode: "match_shape",
    min: 0,
    max: 90,
    mean: 40,
    sd: 20,
    decimals: 0,
    quantiles: q(0, 90),
    na: { tokens: [""], count: 30 },
  },
  { name: "age_next", type: "float", mode: "uniform", min: 0, max: 100, decimals: 1 },
  { name: "license", type: "categorical", storage: "string", counts: { yes: 300, no: 300 } },
  {
    name: "vehicle",
    type: "categorical",
    storage: "string",
    counts: { car: 250, bus: 200, none: 150 },
  },
  {
    name: "note",
    type: "free_text",
    mode: "uniform",
    min: 5,
    max: 30,
    decimals: 0,
    line_breaks: false,
  },
];

const spec = (rules: RuleSpec[]): SpecFile => ({
  spec_version: SPEC_VERSION,
  source: {
    format: "csv",
    file_name: "t.csv",
    encoding: "utf-8",
    delimiter: ",",
    quote: '"',
    header: true,
  },
  n_rows: N,
  seed: 11,
  rules,
  columns,
});

const rows = (s: SpecFile, seed = 11): string[][] => {
  const plan = planTable(s, seed);
  return Array.from({ length: N }, (_, r) => rowValues(plan, r));
};
const index = (name: string) => columns.findIndex((c) => c.name === name);
const day = (text: string) =>
  Math.floor((parseDate(text, "%Y-%m-%d") as Date).getTime() / 86400000);
const second = (text: string) =>
  Math.floor((parseDate(text, "%Y-%m-%d %H:%M:%S") as Date).getTime() / 1000);

describe("follows", () => {
  const rule: RuleSpec = { kind: "follows", column: "end", after: "start", min: 2, max: 30 };

  it("puts a date a number of days after another, and blank when the first is blank", () => {
    let blanks = 0;
    for (const r of rows(spec([rule]))) {
      const start = r[index("start")];
      const end = r[index("end")];
      if (start === "") {
        expect(end).toBe("");
        blanks++;
      } else {
        const gap = day(end) - day(start);
        expect(gap).toBeGreaterThanOrEqual(2);
        expect(gap).toBeLessThanOrEqual(30);
      }
    }
    expect(blanks).toBe(60);
  });

  it("uses every gap in the range, not just one", () => {
    const gaps = new Set(
      rows(spec([rule]))
        .filter((r) => r[index("start")] !== "")
        .map((r) => day(r[index("end")]) - day(r[index("start")])),
    );
    expect(gaps.size).toBeGreaterThan(20);
  });

  it("works in seconds for a date and time, and in units for a number", () => {
    const t = rows(spec([{ kind: "follows", column: "ts_end", after: "ts", min: 60, max: 3600 }]));
    for (const r of t) {
      const gap = second(r[index("ts_end")]) - second(r[index("ts")]);
      expect(gap).toBeGreaterThanOrEqual(60);
      expect(gap).toBeLessThanOrEqual(3600);
    }
    const n = rows(spec([{ kind: "follows", column: "age_next", after: "age", min: 1, max: 5 }]));
    for (const r of n) {
      if (r[index("age")] === "") expect(r[index("age_next")]).toBe("");
      else {
        const gap = Number(r[index("age_next")]) - Number(r[index("age")]);
        expect(gap).toBeGreaterThanOrEqual(1);
        expect(gap).toBeLessThanOrEqual(5);
      }
    }
  });

  it("leaves every other column as it was, and is the same bytes twice whatever the chunking", () => {
    const base = rows(spec([]));
    const withRule = rows(spec([rule]));
    for (const name of ["start", "ts", "age", "license", "note"])
      expect(withRule.map((r) => r[index(name)])).toEqual(base.map((r) => r[index(name)]));
    const a = renderAll(planTable(spec([rule]), 11), 50);
    const b = renderAll(planTable(spec([rule]), 11), 700);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe("blank_with and set_when", () => {
  it("makes a column blank wherever another is blank, and no more than that of its own", () => {
    const rule: RuleSpec = { kind: "blank_with", column: "age_next", with: "age" };
    for (const r of rows(spec([rule])))
      if (r[index("age")] === "") expect(r[index("age_next")]).toBe("");
    expect(rows(spec([rule])).filter((r) => r[index("age_next")] !== "").length).toBe(N - 30);
  });

  it("sets a value wherever another column has a value", () => {
    const rule: RuleSpec = {
      kind: "set_when",
      column: "vehicle",
      when_column: "license",
      when_value: "no",
      value: "none",
    };
    const out = rows(spec([rule]));
    for (const r of out) if (r[index("license")] === "no") expect(r[index("vehicle")]).toBe("none");
    expect(
      new Set(out.filter((r) => r[index("license")] === "yes").map((r) => r[index("vehicle")]))
        .size,
    ).toBeGreaterThan(1);
  });
});

describe("the check table", () => {
  const checks = (s: SpecFile) => {
    const plan = planTable(s, 11);
    const acc = new CheckAccumulator(plan);
    for (let r = 0; r < N; r++) acc.observeRow(rowValues(plan, r));
    return acc.finish();
  };

  it("has one row for each rule, passing, and none for the summaries of the changed column", () => {
    const rules: RuleSpec[] = [
      { kind: "follows", column: "end", after: "start", min: 2, max: 30 },
      {
        kind: "set_when",
        column: "vehicle",
        when_column: "license",
        when_value: "no",
        value: "none",
      },
    ];
    const rows = checks(spec(rules));
    const rule = rows.filter((c) => c.metric === "rule");
    expect(rule).toHaveLength(2);
    expect(rule.every((c) => c.pass)).toBe(true);
    expect(rule[0].achieved).toBe("holds in all 600 rows");
    expect(rows.some((c) => c.column === "end" && c.metric !== "rule")).toBe(false);
    expect(rows.some((c) => c.column === "vehicle" && c.metric !== "rule")).toBe(false);
    expect(rows.every((c) => c.pass)).toBe(true);
  });

  it("says when a rule is broken", () => {
    const plan = planTable(spec([{ kind: "blank_with", column: "age_next", with: "age" }]), 11);
    const acc = new CheckAccumulator(plan);
    let spoiled = 0;
    for (let r = 0; r < N; r++) {
      const values = [...rowValues(plan, r)];
      if (spoiled < 5 && values[index("age")] === "") {
        values[index("age_next")] = "9";
        spoiled++;
      }
      acc.observeRow(values);
    }
    const row = acc.finish().find((c) => c.metric === "rule")!;
    expect(row.pass).toBe(false);
    expect(row.achieved).toMatch(/5 rows break it/);
  });
});

describe("a rule in the spec", () => {
  it("is valid and is kept by the builder only while its columns are in the table", () => {
    const rule: RuleSpec = { kind: "follows", column: "end", after: "start", min: 0, max: 5 };
    expect(validateSpec(spec([rule])).ok).toBe(true);
    const built = buildSpec({
      fileName: "t.csv",
      settings: {
        encoding: "utf-8",
        bom: false,
        delimiter: ",",
        quote: '"',
        quoteStyle: "minimal",
        lineEnding: "lf",
        header: true,
        headerQuoted: false,
        trailingNewline: true,
      },
      rowCount: N,
      seed: 11,
      keepOriginalName: false,
      threshold: 50,
      profiles: [],
      rules: [rule],
    });
    expect(built.rules).toBeUndefined(); // no column of the rule is in the table
  });

  const problems = (rules: RuleSpec[]) => {
    const r = validateSpec(spec(rules));
    return r.ok ? [] : r.problems.map((p) => p.message);
  };

  it("is refused when it does not fit the table", () => {
    expect(
      problems([{ kind: "follows", column: "nope", after: "start", min: 0, max: 5 }]).join(),
    ).toMatch(/does not have/);
    expect(
      problems([{ kind: "follows", column: "end", after: "end", min: 0, max: 5 }]).join(),
    ).toMatch(/follow itself/);
    expect(
      problems([{ kind: "follows", column: "end", after: "start", min: 9, max: 5 }]).join(),
    ).toMatch(/smallest gap/);
    expect(
      problems([{ kind: "follows", column: "end", after: "age", min: 0, max: 5 }]).join(),
    ).toMatch(/both numbers/);
    expect(
      problems([
        {
          kind: "set_when",
          column: "vehicle",
          when_column: "license",
          when_value: "maybe",
          value: "none",
        },
      ]).join(),
    ).toMatch(/not one the first column holds/);
    expect(
      problems([
        {
          kind: "set_when",
          column: "vehicle",
          when_column: "license",
          when_value: "no",
          value: "boat",
        },
      ]).join(),
    ).toMatch(/not one the target column holds/);
    expect(
      problems([
        { kind: "set_when", column: "age", when_column: "license", when_value: "no", value: "x" },
      ]).join(),
    ).toMatch(/two category/);
  });

  it("cannot chain, and a column has one rule", () => {
    const a: RuleSpec = { kind: "follows", column: "end", after: "start", min: 0, max: 5 };
    expect(problems([a, { kind: "blank_with", column: "start", with: "age" }]).join()).toMatch(
      /another rule/,
    );
    expect(problems([a, { kind: "blank_with", column: "end", with: "age" }]).join()).toMatch(
      /only one rule/,
    );
  });

  it("is described in plain words, and in the README", () => {
    const rule: RuleSpec = { kind: "follows", column: "end", after: "start", min: 2, max: 30 };
    expect(describeRule(rule)).toBe("end comes 2 to 30 after start");
    expect(describeRule({ kind: "blank_with", column: "a", with: "b" })).toBe(
      "a is blank when b is blank",
    );
    const text = agentReadme(spec([rule]), {
      fakeFileName: "t_fake.csv",
      seed: 11,
      appVersion: "0.4.0",
    });
    expect(text).toContain("## Rules between columns");
    expect(text).toContain("- end comes 2 to 30 after start");
  });
});
