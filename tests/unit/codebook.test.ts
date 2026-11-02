// A codebook (specs/012): read from CSV or JSON, matched to the columns and values of the table, kept as labels beside them,
// shown in the summary lines, the spec and the README, and never a part of the file's values.

import { describe, expect, it } from "vitest";
import { matchCodebook, MAX_LABEL_LENGTH, parseCodebook } from "../../src/lib/codebook/codebook";
import { summaryLines } from "../../src/features/review/summary";
import { agentReadme } from "../../src/lib/readme/agentReadme";
import { applyEdits } from "../../src/lib/profile/edits";
import type { ColumnProfile } from "../../src/lib/profile/types";
import { columnSpecOf } from "../../src/lib/spec/build";
import { profileFromSpec } from "../../src/lib/spec/toProfiles";
import { SPEC_VERSION, type SpecFile } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";

const mode: ColumnProfile = {
  name: "mode",
  outputName: "mode",
  detectedType: "categorical",
  type: "categorical",
  status: "ok",
  attentionReasons: [],
  naTokens: [],
  naCount: 0,
  naByToken: {},
  sentinels: { "-9": 12 },
  exclude: "include",
  quoted: false,
  summary: { kind: "categorical", storage: "integer", counts: { "1": 300, "2": 150, "3": 50 } },
};

describe("parseCodebook", () => {
  it("reads a CSV with column, value and label", () => {
    const r = parseCodebook("column,value,label\nmode,1,Car\nmode,2,Bus\nmode,-9,Refused\n");
    expect(r.problems).toEqual([]);
    expect(r.entries).toEqual([
      { column: "mode", value: "1", label: "Car" },
      { column: "mode", value: "2", label: "Bus" },
      { column: "mode", value: "-9", label: "Refused" },
    ]);
  });

  it("knows other header names, other delimiters and quoted text", () => {
    const r = parseCodebook('Variable;Code;Description\nmode;1;"Car; driver"\nmode;2;"He said ""hi"""\n');
    expect(r.entries.map((e) => e.label)).toEqual(["Car; driver", 'He said "hi"']);
    expect(parseCodebook("variable\tvalue\tlabel\nmode\t1\tCar\n").entries).toHaveLength(1);
  });

  it("reads JSON as an object of columns, or a list of rows", () => {
    expect(parseCodebook('{"mode": {"1": "Car", "2": "Bus"}, "sex": {"F": "Female"}}').entries).toHaveLength(3);
    expect(parseCodebook('[{"column": "mode", "value": 1, "label": "Car"}]').entries).toEqual([{ column: "mode", value: "1", label: "Car" }]);
  });

  it("says plainly what it could not read, without quoting the file", () => {
    expect(parseCodebook("").problems[0]).toMatch(/empty/);
    expect(parseCodebook("a,b\n1,2\n").problems[0]).toMatch(/first row must name three columns/);
    expect(parseCodebook("{broken").problems[0]).toMatch(/not valid JSON/);
    expect(parseCodebook("{broken").problems[0]).not.toContain("broken");
  });

  it("skips labels that are too long or hold control characters", () => {
    const long = "x".repeat(MAX_LABEL_LENGTH + 1);
    const r = parseCodebook(`column,value,label\nmode,1,${long}\nmode,2,Bus\nmode,3,a\u0007b\n`);
    expect(r.entries).toEqual([{ column: "mode", value: "2", label: "Bus" }]);
    expect(r.problems.join(" ")).toMatch(/longer than 100/);
    expect(r.problems.join(" ")).toMatch(/control characters/);
  });
});

describe("matchCodebook", () => {
  it("keeps a label for a column and a value the table holds, and counts the rest", () => {
    const m = matchCodebook(
      [
        { column: "mode", value: "1", label: "Car" },
        { column: "MODE", value: "-9", label: "Refused" },
        { column: "mode", value: "7", label: "Boat" },
        { column: "nothing", value: "1", label: "x" },
      ],
      [mode],
    );
    expect(m.labels).toEqual({ mode: { "1": "Car", "-9": "Refused" } });
    expect(m).toMatchObject({ applied: 2, columns: 1, unmatched: 2 });
  });

  it("reads 1.0 and 01 as the code 1", () => {
    const m = matchCodebook([{ column: "mode", value: "01", label: "Car" }, { column: "mode", value: "2.0", label: "Bus" }], [mode]);
    expect(m.labels.mode).toEqual({ "1": "Car", "2": "Bus" });
  });
});

describe("labels in the profile, the spec and the README", () => {
  const labelled = applyEdits(mode, { valueLabels: { "1": "Car", "-9": "Refused" } });

  it("are applied as a local edit and removed by null", () => {
    expect(labelled.valueLabels).toEqual({ "1": "Car", "-9": "Refused" });
    expect(applyEdits(labelled, { valueLabels: null }).valueLabels).toBeUndefined();
  });

  it("show beside the codes in the summary lines", () => {
    const lines = summaryLines(labelled);
    expect(lines.join(" ")).toContain("1 (Car): 300");
    expect(lines.join(" ")).toContain("-9 Refused (12)");
  });

  it("go into the spec and come back from it", () => {
    const col = columnSpecOf(labelled);
    expect(col.value_labels).toEqual({ "1": "Car", "-9": "Refused" });
    expect(profileFromSpec(col).valueLabels).toEqual({ "1": "Car", "-9": "Refused" });
  });

  it("must name a value the column holds", () => {
    const spec = (labels: Record<string, string>): SpecFile => ({
      spec_version: SPEC_VERSION,
      source: { format: "csv", file_name: "t.csv", encoding: "utf-8", delimiter: ",", header: true },
      n_rows: 512,
      seed: 1,
      columns: [{ ...columnSpecOf(labelled), value_labels: labels } as SpecFile["columns"][number]],
    });
    expect(validateSpec(spec({ "1": "Car" })).ok).toBe(true);
    const bad = validateSpec(spec({ "9": "Nothing" }));
    expect(bad.ok).toBe(false);
    expect(validateSpec(spec({ "1": "x".repeat(101) })).ok).toBe(false);
    expect(validateSpec(spec({ "1": "" })).ok).toBe(false);
  });

  it("show in the README beside the values and the codes", () => {
    const spec: SpecFile = {
      spec_version: SPEC_VERSION,
      source: { format: "csv", file_name: "t.csv", encoding: "utf-8", delimiter: ",", header: true },
      n_rows: 512,
      seed: 1,
      columns: [columnSpecOf(labelled)],
    };
    const text = agentReadme(spec, { fakeFileName: "t_fake.csv", seed: 1, appVersion: "0.4.0" });
    expect(text).toContain("`1` (Car)");
    expect(text).toContain("codes: `-9` (Refused)");
  });
});
