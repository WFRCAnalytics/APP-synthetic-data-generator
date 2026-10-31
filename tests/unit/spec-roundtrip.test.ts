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
