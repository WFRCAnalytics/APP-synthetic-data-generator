// The README that goes with a fake file (specs/011): built from the spec alone, it says what the file is and what each
// column holds, and holds nothing a spec does not.

import { describe, expect, it } from "vitest";
import { agentReadme, readmeFileNameFor } from "../../src/lib/readme/agentReadme";
import { EMPTY_TEXT_TOKEN, SPEC_VERSION, type ColumnSpec, type SpecFile } from "../../src/lib/spec/types";

const q = (lo: number, hi: number) => Array.from({ length: 101 }, (_, i) => lo + ((hi - lo) * i) / 100);

const columns: ColumnSpec[] = [
  { name: "hh_id", type: "survey_id", mask: [{ literal: "H" }, "digit", "digit", "digit"], repeat_structure: { "1": 400 } },
  { name: "age", type: "integer", mode: "match_shape", min: 18, max: 90, mean: 45, sd: 15, decimals: 0, quantiles: q(18, 90), na: { tokens: [""], count: 20 } },
  { name: "income", type: "float", mode: "uniform", min: 1000.5, max: 90000, decimals: 2 },
  { name: "mode", type: "categorical", storage: "string", counts: { bus: 100, car: 200, walk: 60 }, na: { tokens: ["", EMPTY_TEXT_TOKEN], count: 40, by_token: { "": 30, [EMPTY_TEXT_TOKEN]: 10 } } },
  { name: "when", type: "date", mode: "uniform", min: 19000, max: 19400, format: "%Y-%m-%d", granularity: "day" },
  { name: "who", type: "personal", kind: "full_name", repeat_structure: { "1": 400 } },
  { name: "note", type: "free_text", mode: "uniform", min: 5, max: 60, decimals: 0, line_breaks: false },
  { name: "tags", type: "unsupported", exclude: "drop" },
  { name: "ssn_like", type: "empty", exclude: "drop" },
];

const spec = (source: SpecFile["source"] = { format: "csv", file_name: "trips.csv", encoding: "utf-8", delimiter: ",", quote: '"', header: true, line_ending: "lf" }): SpecFile => ({
  spec_version: SPEC_VERSION,
  source,
  n_rows: 400,
  seed: 42,
  columns,
});

const options = { fakeFileName: "trips_fake.csv", specFileName: "trips_spec.json", seed: 7, appVersion: "0.4.0" };

describe("agentReadme", () => {
  it("says the file is not real, and what it is", () => {
    const text = agentReadme(spec(), options);
    expect(text.startsWith("# trips_fake.csv: synthetic data")).toBe(true);
    expect(text).toMatch(/This data is not real/);
    expect(text).toContain("**Rows**: 400");
    expect(text).toContain("**Type**: CSV");
    expect(text).toContain("seed 7");
    expect(text).toContain("`trips_spec.json`");
    expect(text).toContain("Delimiter `,`");
  });

  it("lists every written column with its kind, what it holds and how much is missing", () => {
    const text = agentReadme(spec(), options);
    expect(text).toContain("| `hh_id` | ID | pattern `H999`");
    expect(text).toContain("| `age` | whole number | 18 to 90 | 20 (5%) as an empty field |");
    expect(text).toContain("| `income` | decimal number | 1000.5 to 90,000, 2 decimal places | none |");
    expect(text).toContain("3 values: `bus`, `car`, `walk`");
    expect(text).toContain("40 (10%) as an empty field or empty text");
    expect(text).toContain("format `%Y-%m-%d`");
    expect(text).toContain("| `who` | invented full name | invented, never copied |");
    expect(text).toContain("5 to 60 characters");
  });

  it("leaves out dropped and unsupported columns, and says how many", () => {
    const text = agentReadme(spec(), options);
    expect(text).not.toContain("`tags`");
    expect(text).not.toContain("ssn_like");
    expect(text).toContain("2 columns of the real table are not in this file.");
    expect(text).toContain("**Columns**: 7");
  });

  it("describes the layout of each file type", () => {
    expect(agentReadme(spec({ format: "xlsx", file_name: "t.xlsx", sheet: "Survey", skip_rows: 2, header: true, date1904: false }), { ...options, fakeFileName: "t_fake.xlsx" })).toMatch(/One sheet named `Survey`; 2 empty rows above the header/);
    expect(agentReadme(spec({ format: "parquet", file_name: "t.parquet", row_groups: 3 }), options)).toMatch(/same schema/);
    expect(agentReadme(spec({ format: "json", file_name: "t.json", form: "lines", indent: "compact", line_ending: "lf", trailing_newline: true, bom: false }), options)).toMatch(/One JSON record per line/);
    expect(agentReadme(spec({ format: "json", file_name: "t.json", form: "array", indent: "2", line_ending: "lf", trailing_newline: true, bom: false }), options)).toMatch(/indented by 2 spaces/);
  });

  it("shows at most twelve labels", () => {
    const many: ColumnSpec = { name: "county", type: "categorical", storage: "string", counts: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`c${i}`, 10])) };
    const text = agentReadme({ ...spec(), columns: [many] }, options);
    expect(text).toContain("30 values: `c0`");
    expect(text).toContain("`c11`, ...");
    expect(text).not.toContain("`c12`");
  });

  it("keeps a table cell on one line even for an odd label", () => {
    const odd: ColumnSpec = { name: "x", type: "categorical", storage: "string", counts: { "a|b": 5, "line\nbreak": 5 } };
    const text = agentReadme({ ...spec(), columns: [odd] }, options);
    const row = text.split("\n").find((l) => l.startsWith("| `x`"))!;
    expect(row.split("|").length).toBe(6); // the pipe in the label does not add a cell
    expect(row).not.toContain("\n");
  });

  it("says no more than the spec holds", () => {
    const text = agentReadme(spec(), options);
    // Nothing that looks like a person, an address or a row: only the names, limits, patterns and labels of the spec.
    expect(text).not.toMatch(/@|\bStreet\b|\d{3}-\d{2}-\d{4}/);
    for (const label of ["bus", "car", "walk"]) expect(JSON.stringify(spec())).toContain(label);
  });

  it("names the file after the fake file", () => {
    expect(readmeFileNameFor("trips_fake.csv")).toBe("trips_fake_README.md");
    expect(readmeFileNameFor("data")).toBe("data_README.md");
  });
});
