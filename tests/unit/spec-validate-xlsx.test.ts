// Spec version 3: the xlsx source and the cell format of a column (specs/003 FR-010, FR-020,
// data-model.md, contracts/spec-file-v3.md).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EMPTY_TEXT_TOKEN, SPEC_VERSION } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";

const csvSource = { format: "csv", file_name: "t.csv", encoding: "utf-8", delimiter: ",", header: true };
const xlsxSource = { format: "xlsx", file_name: "t.xlsx", sheet: "Survey Data", range: "A3:I203", skip_rows: 2, header: true, date1904: false };
const quantiles = Array.from({ length: 101 }, (_, i) => 10 + i);

const spec = (source: unknown, columns: unknown[], over: Record<string, unknown> = {}) => ({ spec_version: 3, source, n_rows: 200, seed: 1, columns, ...over });
const money = (over: Record<string, unknown> = {}) => ({ name: "amount", type: "float", mode: "match_shape", min: 10, max: 110, decimals: 2, quantiles, cell_format: "#,##0.00", ...over });
const when = (over: Record<string, unknown> = {}) => ({ name: "when", type: "date", mode: "uniform", min: 19000, max: 19100, format: "%Y-%m-%d", granularity: "day", cell_format: "mm/dd/yyyy", ...over });
const zip = (over: Record<string, unknown> = {}) => ({ name: "zip", type: "short_string", pattern: ["digit", "digit", "digit", "digit", "digit"], length_groups: { "5": 200 }, repeat_structure: { "1": 200 }, cell_format: "@", ...over });

const ok = (s: unknown) => {
  const r = validateSpec(s);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.spec;
};
const messages = (s: unknown) => {
  const r = validateSpec(s);
  return r.ok ? [] : r.problems.map((p) => `${p.column ?? "-"}:${p.path}:${p.message}`);
};

describe("versions", () => {
  it("writes version 3 and reads 1, 2 and 3", () => {
    expect(SPEC_VERSION).toBe(3);
    for (const v of [1, 2, 3]) expect(validateSpec(spec(csvSource, [money({ cell_format: undefined })], { spec_version: v })).ok, `version ${v}`).toBe(true);
  });

  it("refuses version 4 with the newer-version message, and version 0", () => {
    expect(messages(spec(xlsxSource, [money()], { spec_version: 4 })).join(" ")).toMatch(/newer version of the app/);
    expect(messages(spec(xlsxSource, [money()], { spec_version: 0 })).join(" ")).toMatch(/older, unsupported format/);
  });

  it("still reads the slice 1 and slice 2 fixtures", () => {
    const v1 = JSON.parse(readFileSync(join(__dirname, "../fixtures/spec-v1.json"), "utf8"));
    expect(validateSpec(v1).ok).toBe(true);
  });
});

describe("the xlsx source", () => {
  it("accepts a sheet, a range, rows skipped, a header setting and the date system", () => {
    const s = ok(spec(xlsxSource, [money(), when(), zip()]));
    expect(s.source.format).toBe("xlsx");
  });

  it("accepts a source with no range", () => {
    const { range, ...noRange } = xlsxSource;
    void range;
    expect(validateSpec(spec(noRange, [money()])).ok).toBe(true);
  });

  it("keeps CSV settings off an xlsx source and Excel settings off a CSV source", () => {
    expect(validateSpec(spec({ ...xlsxSource, delimiter: "," }, [money()])).ok).toBe(false);
    expect(validateSpec(spec({ ...xlsxSource, encoding: "utf-8" }, [money()])).ok).toBe(false);
    expect(validateSpec(spec({ ...csvSource, sheet: "Data" }, [money({ cell_format: undefined })])).ok).toBe(false);
    expect(validateSpec(spec({ ...csvSource, skip_rows: 2 }, [money({ cell_format: undefined })])).ok).toBe(false);
  });

  it("needs the sheet, the skipped rows, the header setting and the date system", () => {
    for (const key of ["sheet", "skip_rows", "header", "date1904"]) {
      const { [key]: _gone, ...rest } = xlsxSource as Record<string, unknown>;
      void _gone;
      expect(validateSpec(spec(rest, [money()])).ok, key).toBe(false);
    }
  });

  it("checks the sheet name and the range", () => {
    expect(messages(spec({ ...xlsxSource, sheet: "a/b" }, [money()])).join(" ")).toMatch(/sheet/i);
    expect(messages(spec({ ...xlsxSource, sheet: "x".repeat(32) }, [money()])).join(" ")).toMatch(/sheet/i);
    expect(messages(spec({ ...xlsxSource, range: "A3" + ":" + "B" }, [money()])).join(" ")).toMatch(/range/i);
    expect(messages(spec({ ...xlsxSource, range: "I203:A3" }, [money()])).join(" ")).toMatch(/range/i);
  });

  it("makes the range start at the row after the skipped rows", () => {
    expect(messages(spec({ ...xlsxSource, range: "A5:I203", skip_rows: 2 }, [money()])).join(" ")).toMatch(/skip_rows|rows skipped/);
    expect(validateSpec(spec({ ...xlsxSource, range: "A1:I203", skip_rows: 0 }, [money()])).ok).toBe(true);
  });

  it("keeps a sheet name with spaces and accents exactly", () => {
    const s = ok(spec({ ...xlsxSource, sheet: "Résumé 2024" }, [money()]));
    expect((s.source as { sheet: string }).sheet).toBe("Résumé 2024");
  });

  it("refuses unknown fields, so no value can ride along", () => {
    expect(validateSpec(spec({ ...xlsxSource, first_cell: "secret" }, [money()])).ok).toBe(false);
  });
});

describe("cell formats", () => {
  it("accepts a number format on a number, a date format on a date, and text on a code column", () => {
    expect(validateSpec(spec(xlsxSource, [money(), when(), zip()])).ok).toBe(true);
  });

  it("refuses a date format on a number column, and the reverse", () => {
    expect(messages(spec(xlsxSource, [money({ cell_format: "mm/dd/yyyy" })])).join(" ")).toMatch(/amount:cell_format/);
    expect(messages(spec(xlsxSource, [when({ cell_format: "#,##0.00" })])).join(" ")).toMatch(/when:cell_format/);
  });

  it("refuses text format on a number or a date column, but allows it on text-like columns", () => {
    expect(validateSpec(spec(xlsxSource, [money({ cell_format: "@" })])).ok).toBe(false);
    expect(validateSpec(spec(xlsxSource, [when({ cell_format: "@" })])).ok).toBe(false);
    for (const type of ["personal", "free_text"]) {
      const col = type === "personal" ? { name: "who", type, kind: "full_name", repeat_structure: { "1": 200 }, cell_format: "@" } : { name: "note", type, mode: "uniform", min: 3, max: 50, cell_format: "@" };
      expect(validateSpec(spec(xlsxSource, [col])).ok, type).toBe(true);
    }
  });

  it("accepts percent, currency, scientific and date-time codes where they belong", () => {
    expect(validateSpec(spec(xlsxSource, [money({ cell_format: "0.0%" }), money({ name: "b", cell_format: "$#,##0.00" }), money({ name: "c", cell_format: "0.00E+00" })])).ok).toBe(true);
    expect(validateSpec(spec(xlsxSource, [when({ cell_format: "yyyy-mm-dd hh:mm", type: "datetime", format: "%Y-%m-%d %H:%M:%S", granularity: "second" })])).ok).toBe(true);
  });

  it("limits the length and refuses control characters", () => {
    expect(validateSpec(spec(xlsxSource, [money({ cell_format: "0".repeat(256) })])).ok).toBe(false);
    expect(validateSpec(spec(xlsxSource, [money({ cell_format: "0.00\u0000" })])).ok).toBe(false);
  });

  it("is optional, and ignored for a CSV source", () => {
    expect(validateSpec(spec(xlsxSource, [money({ cell_format: undefined })])).ok).toBe(true);
    expect(validateSpec(spec(csvSource, [money()])).ok).toBe(true);
  });
});

describe("blank cells and empty text", () => {
  it("counts them as separate NA tokens", () => {
    const col = { name: "flag", type: "categorical", counts: { N: 90, Y: 86 }, na: { tokens: ["", EMPTY_TEXT_TOKEN], count: 24, by_token: { "": 10, [EMPTY_TEXT_TOKEN]: 14 } } };
    expect(validateSpec(spec(xlsxSource, [col])).ok).toBe(true);
  });

  it("checks that the counts add up as for any other tokens", () => {
    const col = { name: "flag", type: "categorical", counts: { N: 90, Y: 86 }, na: { tokens: ["", EMPTY_TEXT_TOKEN], count: 24, by_token: { "": 10, [EMPTY_TEXT_TOKEN]: 5 } } };
    expect(validateSpec(spec(xlsxSource, [col])).ok).toBe(false);
  });
});

describe("the JSON schema contract", () => {
  const schema = JSON.parse(readFileSync(join(__dirname, "../../specs/001-csv-synthetic-slice/contracts/spec-file.schema.json"), "utf8"));
  const text = JSON.stringify(schema);

  it("allows versions 1 to 3, the xlsx source and the cell format", () => {
    expect(JSON.stringify(schema.properties.spec_version)).toMatch(/1[\s\S]*2[\s\S]*3/);
    expect(text).toContain('"xlsx"');
    expect(text).toContain('"cell_format"');
    expect(text).toContain('"sheet"');
    expect(text).toContain('"skip_rows"');
    expect(text).toContain('"date1904"');
  });
});
