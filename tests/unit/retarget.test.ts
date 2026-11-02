// @vitest-environment node
// Writing a table as another file type (specs/020): the spec of a CSV table, retargeted, is the spec the same table has when it
// is designed for that file type, and it is a valid spec. The column summaries, the seed and the rows are untouched.
import { describe, expect, it } from "vitest";
import { specFromDesign } from "../../src/lib/design/build";
import { defaultColumn, emptyDesign } from "../../src/lib/design/defaults";
import type { DesignColumn, DesignOutput } from "../../src/lib/design/types";
import { outputKindOf, retarget } from "../../src/lib/spec/retarget";
import { validateSpec } from "../../src/lib/spec/validate";

function columns(): DesignColumn[] {
  const taken: string[] = [];
  const make = <K extends Parameters<typeof defaultColumn>[0]>(kind: K, over: Record<string, unknown>) => {
    const c = { ...defaultColumn(kind, taken), ...over } as DesignColumn;
    taken.push(c.name);
    return c;
  };
  return [
    make("integer", { name: "age", min: 18, max: 90, missingPct: 10 }),
    make("integer", { name: "big", min: 0, max: 5_000_000_000 }),
    make("decimal", { name: "income", min: 1000, max: 90000, decimals: 2 }),
    make("category", { name: "mode", labels: [{ label: "car", weight: 5 }, { label: "bus", weight: 3 }] }),
    make("yesno", { name: "has_pass", yesPct: 30 }),
    make("yesno", { name: "owns", yesLabel: "Owner", noLabel: "Renter" }),
    make("date", { name: "trip_date", start: "2023-01-01", end: "2023-03-31", format: "%Y-%m-%d" }),
    make("datetime", { name: "stamp", start: "2023-01-01", end: "2023-01-31", format: "%Y-%m-%d %H:%M:%S" }),
    make("id", { name: "hh_id", prefix: "H-", digits: 5 }),
    make("personal", { name: "who" }),
    make("text", { name: "note", minLength: 5, maxLength: 40 }),
  ];
}

const specOf = (output: DesignOutput) => {
  const r = specFromDesign({ ...emptyDesign(), tableName: "trips", output, rows: 300, columns: columns() });
  if (!r.ok) throw new Error(r.problems.map((p) => p.message).join("; "));
  return r.spec;
};

const KINDS: DesignOutput[] = ["csv", "xlsx", "parquet", "json", "ndjson"];

describe("retarget", () => {
  const csv = specOf("csv");

  for (const kind of KINDS) {
    it(`a CSV table written as ${kind} is the spec of that table designed for ${kind}`, () => {
      const out = retarget(csv, kind);
      expect(outputKindOf(out)).toBe(kind);
      expect(validateSpec(JSON.parse(JSON.stringify(out))).ok).toBe(true);
      expect(out).toEqual(specOf(kind));
    });
  }

  it("goes from any file type to any other", () => {
    for (const from of KINDS)
      for (const to of KINDS) {
        const out = retarget(specOf(from), to);
        expect(out).toEqual(specOf(to));
      }
  });

  it("leaves a spec that already has the file type as it is", () => {
    expect(retarget(csv, "csv")).toBe(csv);
  });

  it("keeps the seed, rows and column summaries", () => {
    const out = retarget(csv, "parquet");
    expect(out.seed).toBe(csv.seed);
    expect(out.n_rows).toBe(csv.n_rows);
    expect(out.columns.map(({ parquet_type: _p, ...rest }) => rest)).toEqual(csv.columns);
  });

  it("names the file after the one it came from", () => {
    const out = retarget({ ...csv, source: { ...csv.source, file_name: "Survey 2024.csv" } }, "xlsx");
    expect(out.source.file_name).toBe("Survey 2024.xlsx");
  });
});
