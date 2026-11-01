// Spec version 2 and the three text column types (specs/002 FR-009, FR-017, data-model.md): the
// validator accepts versions 1 and 2, refuses newer ones, checks each new column type, and rejects any
// key that could carry a real value.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateSpec } from "../../src/lib/spec/validate";

const quantiles = Array.from({ length: 101 }, (_, i) => 3 + i * 4);

const base = (columns: unknown[], over: Record<string, unknown> = {}) => ({
  spec_version: 2,
  source: { format: "csv", file_name: "t.csv", encoding: "utf-8", delimiter: ",", header: true },
  n_rows: 1000,
  seed: 1,
  columns,
  ...over,
});

const personal = (over: Record<string, unknown> = {}) => ({ name: "who", type: "personal", kind: "full_name", repeat_structure: { "1": 900, "2": 50 }, ...over });
const freeText = (over: Record<string, unknown> = {}) => ({ name: "note", type: "free_text", mode: "match_shape", min: 3, max: 403, mean: 200, sd: 100, quantiles, line_breaks: false, ...over });
const shortString = (over: Record<string, unknown> = {}) => ({
  name: "plate",
  type: "short_string",
  pattern: ["upper", "upper", { literal: "-" }, "digit", "digit", "digit", "digit"],
  length_groups: { "7": 950 },
  repeat_structure: { "1": 950, "2": 25 },
  ...over,
});

const problems = (spec: unknown) => {
  const r = validateSpec(spec);
  return r.ok ? [] : r.problems;
};
const messages = (spec: unknown) => problems(spec).map((p) => `${p.column ?? "-"}:${p.path}:${p.message}`);

describe("spec versions", () => {
  it("accepts version 2", () => {
    expect(validateSpec(base([personal({ repeat_structure: { "1": 1000 } })])).ok).toBe(true);
  });

  it("still accepts version 1 files from slice 1 (FR-017)", () => {
    const old = JSON.parse(readFileSync(join(__dirname, "../fixtures/spec-v1.json"), "utf8"));
    expect(old.spec_version).toBe(1);
    const r = validateSpec(old);
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    expect(r.ok).toBe(true);
  });

  it("refuses a newer version with the newer-version message", () => {
    const [p] = problems(base([personal()], { spec_version: 5 }));
    expect(p.message).toMatch(/newer version of the app/);
  });

  it("refuses version 0 as an older, unsupported format", () => {
    const [p] = problems(base([personal()], { spec_version: 0 }));
    expect(p.message).toMatch(/older, unsupported format/);
  });
});

describe("personal columns", () => {
  it.each(["full_name", "first_name", "last_name", "email", "phone", "address", "url", "ip"])("accepts kind %s", (kind) => {
    expect(validateSpec(base([personal({ kind, repeat_structure: { "1": 1000 } })])).ok).toBe(true);
  });

  it("rejects an unknown kind", () => {
    expect(validateSpec(base([personal({ kind: "passport" })])).ok).toBe(false);
  });

  it("requires the repeat structure to cover the rows left after NA", () => {
    expect(messages(base([personal({ repeat_structure: { "1": 10 } })]))[0]).toMatch(/who:repeat_structure:The repeat structure covers 10 rows, but 1000/);
    const ok = base([personal({ na: { tokens: [""], count: 50 }, repeat_structure: { "1": 950 } })]);
    expect(validateSpec(ok).ok).toBe(true);
  });

  it("rejects a list of values added by hand", () => {
    const [p] = problems(base([personal({ repeat_structure: { "1": 1000 }, values: ["Jane Doe"] })]));
    expect(p.column).toBe("who");
  });

  it("allows format fields only for the kind that uses them", () => {
    expect(validateSpec(base([personal({ kind: "phone", repeat_structure: { "1": 1000 }, format: { shapes: [{ shape: "(999) 999-9999", share: 1 }] } })])).ok).toBe(true);
    expect(validateSpec(base([personal({ kind: "email", repeat_structure: { "1": 1000 }, format: { shapes: [{ shape: "(999) 999-9999", share: 1 }] } })])).ok).toBe(false);
  });

  it("rejects a format shape that carries a real digit or letter", () => {
    const bad = base([personal({ kind: "phone", repeat_structure: { "1": 1000 }, format: { shapes: [{ shape: "(801) 555-0100", share: 1 }] } })]);
    expect(messages(bad).join(" ")).toMatch(/shape/);
  });

  it("needs an acknowledgement for a generated ssn column", () => {
    const col = personal({ kind: "ssn", repeat_structure: { "1": 1000 } });
    expect(messages(base([col])).join(" ")).toMatch(/acknowledg/i);
    expect(validateSpec(base([{ ...col, acknowledged: true }])).ok).toBe(true);
    expect(validateSpec(base([{ ...col, exclude: "drop" }])).ok).toBe(true); // left out, so nothing to acknowledge
  });

  it("allows acknowledged only on ssn", () => {
    expect(validateSpec(base([personal({ acknowledged: true, repeat_structure: { "1": 1000 } })])).ok).toBe(false);
  });
});

describe("free text columns", () => {
  it("accepts length statistics", () => {
    expect(validateSpec(base([freeText()])).ok).toBe(true);
  });

  it("applies the numeric rules to lengths", () => {
    expect(messages(base([freeText({ min: 500 })]))[0]).toMatch(/note:min/);
    expect(messages(base([freeText({ quantiles: [1, 2, 3] })]))[0]).toMatch(/101 quantiles/);
  });

  it("keeps lengths between 0 and 100,000", () => {
    expect(validateSpec(base([freeText({ min: -1 })])).ok).toBe(false);
    expect(messages(base([freeText({ max: 100001, quantiles: undefined, mode: "uniform", mean: undefined, sd: undefined })])).join(" ")).toMatch(/100,000/);
    expect(validateSpec(base([freeText({ max: 100000, quantiles: Array.from({ length: 101 }, (_, i) => 3 + i * 999) })])).ok).toBe(true);
  });

  it("rejects fields that belong to other types", () => {
    expect(validateSpec(base([freeText({ thousands: true })])).ok).toBe(false);
    expect(validateSpec(base([freeText({ words: ["hello"] })])).ok).toBe(false);
  });
});

describe("short string columns", () => {
  it("accepts a pattern, length groups and a repeat structure", () => {
    // the default fixture covers all 1000 rows but its length groups (950) do not match its 975 distinct values
    expect(validateSpec(base([shortString()])).ok).toBe(false);
    expect(validateSpec(base([shortString({ repeat_structure: { "1": 1000 }, length_groups: { "7": 1000 } })])).ok).toBe(true);
  });

  it("requires the repeat structure to cover the rows left after NA", () => {
    expect(messages(base([shortString({ repeat_structure: { "1": 10 }, length_groups: { "7": 10 } })])).join(" ")).toMatch(/plate:repeat_structure/);
  });

  it("requires the length groups to add up to the distinct count", () => {
    expect(messages(base([shortString({ repeat_structure: { "1": 1000 }, length_groups: { "7": 900 } })])).join(" ")).toMatch(/length_groups/);
  });

  it("requires the longest length to equal the pattern length", () => {
    expect(messages(base([shortString({ repeat_structure: { "1": 1000 }, length_groups: { "6": 1000 } })])).join(" ")).toMatch(/pattern/);
  });

  it("allows at most 64 lengths", () => {
    const groups: Record<string, number> = {};
    for (let l = 1; l <= 65; l++) groups[String(l)] = 1;
    const pattern = Array.from({ length: 65 }, () => "alnum");
    expect(validateSpec(base([shortString({ pattern, length_groups: groups, repeat_structure: { "1": 65 } })], { n_rows: 65 })).ok).toBe(false);
  });

  it("reports a pattern too narrow for a length", () => {
    const narrow = shortString({ pattern: ["digit"], length_groups: { "1": 30 }, repeat_structure: { "1": 30 } });
    expect(messages(base([narrow], { n_rows: 30 })).join(" ")).toMatch(/allows 10 distinct values but .*needs 30/);
  });

  it("rejects a list of values added by hand", () => {
    expect(validateSpec(base([shortString({ repeat_structure: { "1": 1000 }, length_groups: { "7": 1000 }, values: ["AB-1234"] })])).ok).toBe(false);
  });
});

describe("the JSON schema contract", () => {
  const schema = JSON.parse(readFileSync(join(__dirname, "../../specs/001-csv-synthetic-slice/contracts/spec-file.schema.json"), "utf8"));
  const text = JSON.stringify(schema);

  it("allows versions 1 and 2 and names the three new column types", () => {
    expect(text).toContain('"personal"');
    expect(text).toContain('"free_text"');
    expect(text).toContain('"short_string"');
    expect(schema.properties.spec_version.enum ?? schema.properties.spec_version.const).toBeDefined();
    expect(JSON.stringify(schema.properties.spec_version)).toMatch(/1[\s\S]*2/);
  });
});
