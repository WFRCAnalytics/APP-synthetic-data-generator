// FR-017, FR-018: saving a spec and loading it again restores every setting. The check is that the
// loaded columns, built into a spec again, give back exactly the spec that was saved.

import { describe, expect, it } from "vitest";
import { parseSpecText } from "../../src/features/spec/loadSpec";
import { specFileNameFor, specToJson } from "../../src/features/spec/saveSpec";
import { applyAllEdits } from "../../src/lib/profile/edits";
import { buildSpec } from "../../src/lib/spec/build";
import { histogramFromQuantiles, profilesFromSpec, settingsFromSource } from "../../src/lib/spec/toProfiles";
import { SPEC_VERSION, type SpecFile } from "../../src/lib/spec/types";

const quantiles = Array.from({ length: 101 }, (_, i) => 10 + i * 0.9);

const spec: SpecFile = {
  spec_version: SPEC_VERSION,
  source: { format: "csv", file_name: "trips.csv", encoding: "windows-1252", bom: false, delimiter: ";", quote: '"', quote_style: "per_column", line_ending: "crlf", trailing_newline: false, header: true, header_quoted: true },
  n_rows: 1000,
  seed: 7,
  keep_original_name: true,
  categorical_threshold: 30,
  columns: [
    { name: "mode", type: "categorical", quoted: false, storage: "integer", counts: { "1": 600, "2": 270, "97": 100 }, na: { tokens: ["", "NA"], count: 30, by_token: { "": 20, NA: 10 } } },
    { name: "fee", type: "float", quoted: true, mode: "match_shape", min: 10, max: 100, mean: 55, sd: 26, decimals: 2, quantiles, rescale: true, sentinels: { "-9": 4 } },
    { name: "count", type: "integer", quoted: false, mode: "uniform", min: 1, max: 12, mean: 6, sd: 3, decimals: 0, quantiles: Array.from({ length: 101 }, (_, i) => 1 + (i * 11) / 100), thousands: true },
    { name: "when", type: "datetime", quoted: true, mode: "match_mean_sd", min: 19000.25, max: 19100.75, mean: 19050, sd: 20, decimals: 0, quantiles: Array.from({ length: 101 }, (_, i) => 19000.25 + i), format: "%Y-%m-%d %H:%M", granularity: "minute" },
    { name: "hh_id", output_name: "household", type: "survey_id", quoted: false, mask: ["digit", "digit", "digit", "digit"], min: 1000, max: 9999, pad_width: 0, repeat_structure: { "1": 600, "2": 200 } },
    { name: "site", type: "survey_id", quoted: false, mask: ["upper", { literal: "-" }, "digit", "digit"], pad_width: 0, repeat_structure: { "1": 1000 } },
    { name: "flag", type: "boolean", quoted: false, storage: "string", counts: { N: 700, Y: 300 }, merge_under_k: 5, label_codes: true },
    { name: "who", type: "personal", quoted: true, kind: "full_name", repeat_structure: { "1": 900, "2": 50 }, format: { last_first: true } },
    { name: "phone", type: "personal", quoted: false, kind: "phone", repeat_structure: { "1": 1000 }, format: { shapes: [{ shape: "(999) 999-9999", share: 0.8 }, { shape: "999-999-9999", share: 0.2 }] } },
    { name: "ssn", type: "personal", quoted: false, kind: "ssn", repeat_structure: { "1": 1000 }, format: { shape: "999-99-9999" }, acknowledged: true },
    { name: "comments", type: "free_text", quoted: false, mode: "match_shape", min: 3, max: 403, mean: 200, sd: 100, decimals: 0, quantiles: Array.from({ length: 101 }, (_, i) => 3 + i * 4), line_breaks: true },
    { name: "plate", type: "short_string", quoted: false, pattern: ["upper", "upper", { literal: "-" }, "digit", "digit", "digit", "digit"], length_groups: { "7": 1000 }, repeat_structure: { "1": 1000 } },
    { name: "note", type: "unsupported", exclude: "drop", quoted: false } as never,
    { name: "blank", type: "empty", quoted: false, exclude: "keep_as_na" },
  ],
};

const rebuild = (s: SpecFile): SpecFile =>
  buildSpec({ fileName: s.source.file_name, settings: settingsFromSource(s.source), rowCount: s.n_rows, seed: s.seed, keepOriginalName: s.keep_original_name ?? false, threshold: s.categorical_threshold ?? 50, profiles: profilesFromSpec(s.columns) });

describe("the spec used here is itself valid", () => {
  it("passes validation", () => {
    const result = parseSpecText(JSON.stringify(spec));
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(result.ok).toBe(true);
  });
});

describe("save then load", () => {
  it("restores every column and file setting", () => {
    const result = parseSpecText(specToJson(spec));
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    // `note` is written without quoted, as buildSpec writes unsupported columns.
    const expected = { ...spec, columns: spec.columns.map((c) => (c.type === "unsupported" ? { name: c.name, exclude: "drop", type: "unsupported" } : c)) };
    expect(rebuild(result.spec)).toEqual(expected);
  });

  it("is stable: saving what was loaded gives the same text", () => {
    const once = specToJson(rebuild(spec));
    const loaded = parseSpecText(once);
    if (!loaded.ok) throw new Error("expected a valid spec");
    expect(specToJson(rebuild(loaded.spec))).toBe(once);
  });

  it("keeps the settings chosen on Review", () => {
    const base = profilesFromSpec(spec.columns);
    const edited = applyAllEdits(base, {
      fee: { mode: "uniform", decimals: 3, outputName: "price" },
      flag: { mergeUnderK: 10, labelCodes: false },
      mode: { exclude: "keep_as_na" },
      hh_id: { idPattern: { mask: ["digit", "digit", "digit", "digit", "digit"], min: 10000, max: 99999, pad: 0 } },
    });
    const saved = buildSpec({ fileName: "trips.csv", settings: settingsFromSource(spec.source), rowCount: 1000, seed: 7, keepOriginalName: true, threshold: 30, profiles: edited });
    const loaded = parseSpecText(specToJson(saved));
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems));
    const col = (name: string) => loaded.spec.columns.find((c) => c.name === name) as unknown as Record<string, unknown>;
    expect(col("fee")).toMatchObject({ mode: "uniform", decimals: 3, output_name: "price" });
    expect(col("flag")).toMatchObject({ merge_under_k: 10 });
    expect(col("flag").label_codes).toBeUndefined();
    expect(col("mode")).toMatchObject({ exclude: "keep_as_na" });
    expect(col("hh_id")).toMatchObject({ mask: ["digit", "digit", "digit", "digit", "digit"], min: 10000, max: 99999 });
    // and they survive a second round
    expect(rebuild(loaded.spec)).toEqual(loaded.spec);
  });
});

describe("the text column types", () => {
  it("round trip with their format fields and the SSN acknowledgement", () => {
    const loaded = profilesFromSpec(spec.columns);
    const who = loaded.find((p) => p.name === "who")!;
    expect(who.type).toBe("personal");
    expect(who.summary).toMatchObject({ kind: "personal", personalKind: "full_name", distinct: 950, format: { last_first: true } });
    expect(loaded.find((p) => p.name === "ssn")!.acknowledged).toBe(true);
    expect(loaded.find((p) => p.name === "comments")!.summary).toMatchObject({ kind: "free_text", lineBreaks: true });
    expect(loaded.find((p) => p.name === "plate")!.summary).toMatchObject({ kind: "short_string", distinct: 1000 });
  });

  it("an SSN-style column without the acknowledgement loads as unsupported and left out", () => {
    const col = { name: "ssn", type: "personal", kind: "ssn", repeat_structure: { "1": 5 }, exclude: "drop" } as never;
    const p = profilesFromSpec([col])[0];
    expect(p.type).toBe("unsupported");
    expect(p.exclude).toBe("drop");
    expect(p.attentionReasons).toContain("ssn_needs_acknowledgement");
  });

  it("edits to the kind and the acknowledgement are kept in the saved spec", () => {
    const base = profilesFromSpec([{ name: "ssn", type: "personal", kind: "ssn", repeat_structure: { "1": 5 }, exclude: "drop" } as never]);
    const acked = applyAllEdits(base, { ssn: { ssnAcknowledged: true } })[0];
    expect(acked.type).toBe("personal");
    expect(acked.exclude).toBe("include");
    const saved = buildSpec({ fileName: "t.csv", settings: settingsFromSource(spec.source), rowCount: 5, seed: 1, keepOriginalName: false, threshold: 50, profiles: [acked] });
    expect(saved.columns[0]).toMatchObject({ type: "personal", kind: "ssn", acknowledged: true });
    const asEmail = applyAllEdits(base, { ssn: { personalKind: "email" } })[0];
    expect(asEmail.type).toBe("personal");
    expect(asEmail.status).toBe("ok");
    expect(asEmail.summary).toMatchObject({ personalKind: "email" });
  });
});

describe("loading fills in what the card needs", () => {
  it("redraws the chart from the quantiles", () => {
    const h = histogramFromQuantiles(quantiles, 10, 100);
    expect(h).toHaveLength(20);
    expect(h.reduce((a, b) => a + b, 0)).toBe(101);
    const flat = histogramFromQuantiles(Array(101).fill(5), 5, 5);
    expect(flat[0]).toBe(101);
  });

  it("reads missing optional fields as their defaults", () => {
    const s = settingsFromSource({ format: "csv", file_name: "a.csv", encoding: "utf-8", delimiter: ",", header: true });
    expect(s).toMatchObject({ bom: false, quote: '"', quoteStyle: "minimal", lineEnding: "lf", headerQuoted: false, trailingNewline: true });
  });

  it("marks an ID pattern that is too narrow for its repeat structure", () => {
    const narrow = profilesFromSpec([{ name: "id", type: "survey_id", mask: ["digit"], repeat_structure: { "1": 50 } }])[0];
    expect(narrow.status).toBe("needs_attention");
    expect(narrow.attentionReasons).toContain("id_mask_too_narrow");
  });

  it("names the spec file after the source", () => {
    expect(specFileNameFor("trips.csv")).toBe("trips_spec.json");
    expect(specFileNameFor("noext")).toBe("noext_spec.json");
  });
});

describe("a spec that cannot be used", () => {
  it("is refused with a fixed message when it is not JSON, never quoting the text", () => {
    const r = parseSpecText("{ secret-value: 12345 ");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(JSON.stringify(r.problems)).not.toContain("secret-value");
      expect(r.problems[0].column).toBeNull();
    }
  });

  it("is refused when it is JSON but not an object", () => {
    expect(parseSpecText("[1,2]").ok).toBe(false);
    expect(parseSpecText("null").ok).toBe(false);
  });

  it("names the column that has the problem", () => {
    const bad = JSON.parse(JSON.stringify(spec));
    bad.columns[1].min = 500; // above max
    const r = parseSpecText(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.some((p) => p.column === "fee")).toBe(true);
  });
});

describe("the xlsx source and cell formats (specs/003 FR-010)", () => {
  const xlsxSpec: SpecFile = {
    spec_version: SPEC_VERSION,
    source: { format: "xlsx", file_name: "survey.xlsx", sheet: "Survey Data", range: "A3:E203", skip_rows: 2, header: true, date1904: true },
    n_rows: 200,
    seed: 5,
    columns: [
      { name: "amount", type: "float", quoted: false, mode: "uniform", min: 10, max: 110, mean: 60, sd: 29, decimals: 2, quantiles: Array.from({ length: 101 }, (_, i) => 10 + i), cell_format: "#,##0.00" },
      { name: "when", type: "date", quoted: false, mode: "uniform", min: 19000, max: 19100, mean: 19050, sd: 29, decimals: 0, quantiles: Array.from({ length: 101 }, (_, i) => 19000 + i), format: "%Y-%m-%d", granularity: "day", cell_format: "mm/dd/yyyy" },
      { name: "zip", type: "short_string", quoted: false, cell_format: "@", pattern: ["digit", "digit", "digit", "digit", "digit"], length_groups: { "5": 200 }, repeat_structure: { "1": 200 } },
      { name: "flag", type: "categorical", quoted: false, storage: "string", counts: { N: 90, Y: 86 }, na: { tokens: ["", "\u0001"], count: 24, by_token: { "": 10, "\u0001": 14 } } },
    ],
  };

  it("round trips the source settings and the cell formats", () => {
    const loaded = parseSpecText(specToJson(xlsxSpec));
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems));
    const settings = settingsFromSource(loaded.spec.source);
    expect(settings).toEqual({ sheet: "Survey Data", range: "A3:E203", skipRows: 2, header: true, date1904: true });
    const profiles = profilesFromSpec(loaded.spec.columns);
    expect(profiles.map((p) => p.cellFormat)).toEqual(["#,##0.00", "mm/dd/yyyy", "@", undefined]);
    const again = buildSpec({ fileName: "survey.xlsx", settings, rowCount: 200, seed: 5, keepOriginalName: false, threshold: 50, profiles });
    expect(again.source).toEqual(xlsxSpec.source);
    expect(again.columns.map((c) => c.cell_format)).toEqual(["#,##0.00", "mm/dd/yyyy", "@", undefined]);
  });

  it("keeps blank cells and empty text apart in the NA counts", () => {
    const flag = profilesFromSpec(xlsxSpec.columns)[3];
    expect(flag.naByToken).toEqual({ "": 10, "\u0001": 14 });
    expect(flag.naCount).toBe(24);
  });

  it("a CSV source still builds a CSV source", () => {
    const csv = buildSpec({ fileName: "a.csv", settings: settingsFromSource(spec.source), rowCount: 1000, seed: 7, keepOriginalName: false, threshold: 50, profiles: profilesFromSpec(spec.columns) });
    expect(csv.source.format).toBe("csv");
  });
});

describe("the parquet source and Parquet types (specs/005 FR-005, FR-009)", () => {
  const parquetSpec: SpecFile = {
    spec_version: SPEC_VERSION,
    source: { format: "parquet", file_name: "survey.parquet", row_groups: 3 },
    n_rows: 200,
    seed: 5,
    columns: [
      { name: "amount", type: "float", quoted: false, mode: "uniform", min: 10, max: 110, mean: 60, sd: 29, decimals: 2, quantiles: Array.from({ length: 101 }, (_, i) => 10 + i), parquet_type: { kind: "decimal", precision: 10, scale: 2, nullable: true } },
      { name: "when", type: "date", quoted: false, mode: "uniform", min: 19000, max: 19100, mean: 19050, sd: 29, decimals: 0, quantiles: Array.from({ length: 101 }, (_, i) => 19000 + i), format: "%Y-%m-%d", granularity: "day", parquet_type: { kind: "date", nullable: false } },
      { name: "flag", type: "categorical", quoted: false, storage: "string", counts: { N: 90, Y: 86 }, na: { tokens: ["", "\u0001"], count: 24, by_token: { "": 10, "\u0001": 14 } }, parquet_type: { kind: "string", nullable: true } },
    ],
  };

  it("round trips the source and the column types", () => {
    const loaded = parseSpecText(specToJson(parquetSpec));
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems));
    const settings = settingsFromSource(loaded.spec.source);
    expect(settings).toEqual({ parquet: true, rowGroups: 3 });
    const profiles = profilesFromSpec(loaded.spec.columns);
    expect(profiles.map((p) => p.parquetType?.kind)).toEqual(["decimal", "date", "string"]);
    const again = buildSpec({ fileName: "survey.parquet", settings, rowCount: 200, seed: 5, keepOriginalName: false, threshold: 50, profiles });
    expect(again.source).toEqual(parquetSpec.source);
    expect(again.columns.map((c) => c.parquet_type)).toEqual(parquetSpec.columns.map((c) => c.parquet_type));
  });

  it("holds no value, statistic or file metadata text in what it saves", () => {
    const text = specToJson(parquetSpec);
    for (const word of ["created_by", "key_value", "statistics", "compression", "min_value", "max_value", "bloom"]) expect(text).not.toContain(word);
  });
});
