import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateSpec } from "../../src/lib/spec/validate";

const quantiles = Array.from({ length: 101 }, (_, i) => i); // 0..100

// A small but complete valid spec covering each in-scope type (row count 100).
function validSpec() {
  return {
    spec_version: 1,
    source: {
      format: "csv",
      file_name: "trips.csv",
      encoding: "utf-8",
      delimiter: ",",
      quote: '"',
      quote_style: "per_column",
      header: true,
    },
    n_rows: 100,
    seed: 42,
    columns: [
      { name: "hh_id", type: "survey_id", mask: ["digit", "digit", "digit", "digit", "digit"], min: 10000, max: 99999, repeat_structure: { "1": 40, "2": 30 }, quoted: false },
      {
        name: "mode",
        type: "categorical",
        storage: "integer",
        counts: { "1": 50, "2": 30, "97": 15 },
        na: { tokens: [""], count: 5 },
        quoted: true,
      },
      {
        name: "dist",
        type: "float",
        mode: "match_shape",
        min: 0,
        max: 100,
        mean: 50,
        sd: 20,
        decimals: 2,
        quantiles,
        sentinels: { "-9": 10 },
      },
      { name: "when", type: "date", mode: "uniform", min: 0, max: 10, format: "%Y-%m-%d", granularity: "day" },
      { name: "email", type: "unsupported", exclude: "drop" },
      { name: "blank", type: "empty", na: { tokens: [""], count: 100 } },
    ],
  };
}

describe("a valid spec", () => {
  it("validates and returns the typed spec", () => {
    const result = validateSpec(validSpec());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.spec.columns).toHaveLength(6);
  });

  it("survives a JSON round trip", () => {
    const result = validateSpec(JSON.parse(JSON.stringify(validSpec())));
    expect(result.ok).toBe(true);
  });
});

describe("structure problems are named by column", () => {
  it("reports a bad field under its column", () => {
    const spec = validSpec();
    (spec.columns[2] as { decimals?: number }).decimals = 99;
    const result = validateSpec(spec);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems[0].column).toBe("dist");
      expect(result.problems[0].path).toContain("decimals");
    }
  });

  it("reports an unknown column type", () => {
    const spec = validSpec();
    (spec.columns[1] as { type: string }).type = "wizard";
    const result = validateSpec(spec);
    expect(result.ok).toBe(false);
  });

  it("falls back to a position when a column has no usable name", () => {
    const spec = validSpec();
    (spec.columns[3] as { name: unknown }).name = 12;
    const result = validateSpec(spec);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.some((p) => p.column === "column #4")).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(validateSpec(null).ok).toBe(false);
    expect(validateSpec("text").ok).toBe(false);
    expect(validateSpec([]).ok).toBe(false);
  });

  it("rejects a spec with no columns", () => {
    const spec = validSpec();
    spec.columns = [];
    expect(validateSpec(spec).ok).toBe(false);
  });
});

describe("version check", () => {
  it("explains a newer spec", () => {
    const result = validateSpec({ ...validSpec(), spec_version: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0].message).toMatch(/newer version/);
  });

  it("explains an older spec", () => {
    const result = validateSpec({ ...validSpec(), spec_version: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0].message).toMatch(/older/);
  });
});

describe("privacy guards", () => {
  it("rejects an ID list hidden in a survey_id column", () => {
    const spec = validSpec();
    (spec.columns[0] as Record<string, unknown>).values = ["10234", "10235"];
    const result = validateSpec(spec);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0].column).toBe("hh_id");
  });

  it("rejects data carried by an unsupported column", () => {
    const spec = validSpec();
    (spec.columns[4] as Record<string, unknown>).counts = { "a@b.com": 3 };
    expect(validateSpec(spec).ok).toBe(false);
    const spec2 = validSpec();
    (spec2.columns[4] as Record<string, unknown>).quantiles = quantiles;
    expect(validateSpec(spec2).ok).toBe(false);
  });

  it("rejects unknown top-level fields", () => {
    expect(validateSpec({ ...validSpec(), rows: [["a"]] }).ok).toBe(false);
  });
});

describe("cross-field rules", () => {
  const problemsOf = (spec: unknown) => {
    const r = validateSpec(spec);
    return r.ok ? [] : r.problems;
  };

  it("flags duplicate column names", () => {
    const spec = validSpec();
    spec.columns[1].name = "hh_id";
    expect(problemsOf(spec).some((p) => p.message.includes("Duplicate"))).toBe(true);
  });

  it("flags category counts that do not add up", () => {
    const spec = validSpec();
    (spec.columns[1] as { counts: Record<string, number> }).counts = { "1": 50, "2": 30 };
    const p = problemsOf(spec).find((x) => x.column === "mode");
    expect(p?.message).toMatch(/add up to 80/);
  });

  it("flags a boolean with three values", () => {
    const spec = validSpec();
    spec.columns[1] = { name: "flag", type: "boolean", counts: { a: 30, b: 30, c: 40 } } as never;
    expect(problemsOf(spec).some((p) => p.column === "flag")).toBe(true);
  });

  it("flags min greater than max", () => {
    const spec = validSpec();
    Object.assign(spec.columns[2], { min: 100, max: 0 });
    expect(problemsOf(spec).some((p) => p.path === "min")).toBe(true);
  });

  it("flags quantiles of the wrong length, order or range", () => {
    const short = validSpec();
    (short.columns[2] as { quantiles: number[] }).quantiles = [0, 1, 2];
    expect(problemsOf(short).some((p) => p.path === "quantiles")).toBe(true);

    const unordered = validSpec();
    const q = [...quantiles];
    q[50] = 10;
    (unordered.columns[2] as { quantiles: number[] }).quantiles = q;
    expect(problemsOf(unordered).some((p) => p.message.includes("decrease"))).toBe(true);

    const outside = validSpec();
    (outside.columns[2] as { quantiles: number[] }).quantiles = quantiles.map((x) => x + 500);
    expect(problemsOf(outside).some((p) => p.message.includes("outside"))).toBe(true);
  });

  it("requires the inputs each numeric mode depends on", () => {
    const spec = validSpec();
    Object.assign(spec.columns[2], { mode: "match_mean_sd", mean: undefined });
    expect(problemsOf(spec).some((p) => p.path === "mode")).toBe(true);
    const shape = validSpec();
    Object.assign(shape.columns[2], { mode: "match_shape", quantiles: undefined });
    expect(problemsOf(shape).some((p) => p.message.includes("quantiles"))).toBe(true);
  });

  it("rejects an unsupported date directive and a mismatched kind or granularity", () => {
    const bad = validSpec();
    Object.assign(bad.columns[3], { format: "%Y-%m-%d %Z" });
    expect(problemsOf(bad).some((p) => p.path === "format")).toBe(true);

    const kind = validSpec();
    Object.assign(kind.columns[3], { format: "%H:%M", granularity: "minute" });
    expect(problemsOf(kind).some((p) => p.message.includes("describes a time"))).toBe(true);

    const gran = validSpec();
    Object.assign(gran.columns[3], { granularity: "second" });
    expect(problemsOf(gran).some((p) => p.path === "granularity")).toBe(true);
  });

  it("checks the ID repeat structure against the non-NA rows", () => {
    const spec = validSpec();
    (spec.columns[0] as { repeat_structure: Record<string, number> }).repeat_structure = { "1": 40, "2": 10 };
    const p = problemsOf(spec).find((x) => x.column === "hh_id");
    expect(p?.message).toMatch(/covers 60 rows/);

    const bad = validSpec();
    (bad.columns[0] as { repeat_structure: Record<string, number> }).repeat_structure = { "0": 5, "x": 1 };
    expect(problemsOf(bad).some((x) => x.path === "repeat_structure")).toBe(true);
  });

  it("flags NA plus sentinel counts above the row count", () => {
    const spec = validSpec();
    (spec.columns[1] as { na: { tokens: string[]; count: number } }).na = { tokens: [""], count: 500 };
    expect(problemsOf(spec).some((p) => p.path === "na")).toBe(true);
  });

  it("flags a mean outside min and max", () => {
    const spec = validSpec();
    Object.assign(spec.columns[2], { mean: 1000 });
    expect(problemsOf(spec).some((p) => p.path === "mean")).toBe(true);
  });
});

describe("the validator and the published JSON schema agree", () => {
  const schema = JSON.parse(
    readFileSync(join(__dirname, "../../specs/001-csv-synthetic-slice/contracts/spec-file.schema.json"), "utf8"),
  );

  it("requires the same top-level fields", () => {
    for (const field of schema.required as string[]) {
      const spec = validSpec() as Record<string, unknown>;
      delete spec[field];
      expect(validateSpec(spec).ok).toBe(false);
    }
  });

  it("allows the same column types", () => {
    const types: string[] = schema.$defs.column.properties.type.enum;
    expect(types.sort()).toEqual(
      ["boolean", "categorical", "date", "datetime", "empty", "float", "integer", "personal", "free_text", "short_string", "survey_id", "time", "unsupported"].sort(),
    );
  });

  it("allows the same quote styles", () => {
    expect(schema.properties.source.properties.quote_style.enum).toEqual(["minimal", "all", "per_column"]);
  });
});
