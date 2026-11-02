// Spec version 5: the json source and the JSON kind of a column (specs/007 FR-005, FR-010, FR-015,
// data-model.md, contracts/spec-file-v5.md). A JSON spec holds structure only.

import { describe, expect, it } from "vitest";
import { SPEC_VERSION } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";

const csvSource = { format: "csv", file_name: "t.csv", encoding: "utf-8", delimiter: ",", header: true };
const jsonSource = { format: "json", file_name: "trips.json", form: "array", indent: "2", line_ending: "lf", trailing_newline: true, bom: false };
const quantiles = Array.from({ length: 101 }, (_, i) => i);

const spec = (source: unknown, columns: unknown[], over: Record<string, unknown> = {}) => ({ spec_version: 5, source, n_rows: 200, seed: 1, columns, ...over });
const age = (over: Record<string, unknown> = {}) => ({ name: "age", type: "integer", mode: "match_shape", min: 0, max: 100, decimals: 0, quantiles, json_kind: "number", json_missing: 0, ...over });
const id = (over: Record<string, unknown> = {}) => ({ name: "id", type: "free_text", mode: "uniform", min: 3, max: 9, ...over, json_kind: "string", json_missing: 0 });
const flag = (over: Record<string, unknown> = {}) => ({ name: "ok", type: "boolean", storage: "string", counts: { true: 120, false: 80 }, json_kind: "boolean", json_missing: 0, ...over });
const nested = (over: Record<string, unknown> = {}) => ({ name: "detail", type: "unsupported", json_kind: "object", ...over });

const messages = (s: unknown) => {
  const r = validateSpec(s);
  return r.ok ? [] : r.problems.map((p) => `${p.column ?? "-"}:${p.path}:${p.message}`);
};
const ok = (s: unknown) => {
  const r = validateSpec(s);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.spec;
};

describe("version 5", () => {
  it("is the version this app writes, and a JSON spec of it is valid", () => {
    expect(SPEC_VERSION).toBe(5);
    const s = ok(spec(jsonSource, [age(), id(), flag(), nested()]));
    expect(s.source).toEqual(jsonSource);
    expect(s.columns[0].json_kind).toBe("number");
  });
});

describe("the json source", () => {
  it.each([
    ["no file name", { ...jsonSource, file_name: undefined }],
    ["an unknown form", { ...jsonSource, form: "object" }],
    ["an unknown indent", { ...jsonSource, indent: "3" }],
    ["a carriage-return line ending", { ...jsonSource, line_ending: "cr" }],
    ["an extra field", { ...jsonSource, delimiter: "," }],
  ])("refuses %s", (_name, source) => {
    expect(validateSpec(spec(source, [age()])).ok).toBe(false);
  });

  it("accepts both forms and every indent", () => {
    for (const form of ["array", "lines"]) for (const indent of ["compact", "2", "4", "tab"]) ok(spec({ ...jsonSource, form, indent }, [age()]));
  });
});

describe("json_kind on a column", () => {
  it("is needed on every column of a JSON spec", () => {
    expect(messages(spec(jsonSource, [age({ json_kind: undefined })])).join(" ")).toMatch(/needs its JSON kind/);
  });

  it("is refused on a CSV spec", () => {
    expect(messages(spec(csvSource, [age()])).join(" ")).toMatch(/Only a spec for a JSON file/);
  });

  it("must be one of the kinds", () => {
    expect(validateSpec(spec(jsonSource, [age({ json_kind: "date" })])).ok).toBe(false);
  });

  it("must suit the column type", () => {
    expect(messages(spec(jsonSource, [age({ type: "date", format: "%Y-%m-%d", granularity: "day", min: 19000, max: 19100 })])).join(" ")).toMatch(/numbers cannot be a date/);
    expect(messages(spec(jsonSource, [flag({ json_kind: "number" }), age({ name: "n", json_kind: "boolean" })])).join(" ")).toMatch(/true and false/);
    expect(messages(spec(jsonSource, [nested({ json_kind: "number" })])).join(" ")).toMatch(/must be an object or a list/);
    expect(messages(spec(jsonSource, [nested(), nested({ name: "tags", json_kind: "array" })])).length).toBe(0);
    expect(messages(spec(jsonSource, [{ name: "x", type: "integer", mode: "uniform", min: 0, max: 5, json_kind: "object", json_missing: 0 }])).join(" ")).toMatch(/object or a list is not supported/);
  });

  it("lets a text key hold numbers or dates as strings", () => {
    ok(spec(jsonSource, [age({ json_kind: "string" })]));
  });

  it("counts records without the key within the missing values", () => {
    ok(spec(jsonSource, [age({ na: { tokens: [""], count: 30 }, json_missing: 30 })]));
    expect(messages(spec(jsonSource, [age({ na: { tokens: [""], count: 30 }, json_missing: 31 })])).join(" ")).toMatch(/cannot outnumber/);
    expect(validateSpec(spec(jsonSource, [age({ json_missing: -1 })])).ok).toBe(false);
  });

  it("refuses cell formats, which a JSON spec does not have", () => {
    expect(messages(spec(jsonSource, [age({ cell_format: "0.00" })])).join(" ")).toMatch(/no cell formats/);
  });

  it("holds no value: a nested key keeps only its name and kind", () => {
    const s = ok(spec(jsonSource, [age(), nested()]));
    expect(Object.keys(s.columns[1]).sort()).toEqual(["json_kind", "name", "type"]);
  });
});
