import { describe, expect, it } from "vitest";
import { applyAllEdits, applyEdits, parseList } from "../../src/lib/profile/edits";
import type { ColumnProfile } from "../../src/lib/profile/types";
import { countByType, filterProfiles, isFiltering, NO_FILTERS } from "../../src/features/review/filter";

const base = { outputName: "", naTokens: [] as string[], naCount: 0, naByToken: {}, sentinels: {}, exclude: "include" as const, quoted: false, attentionReasons: [] };
const numeric = (over: Partial<ColumnProfile> = {}): ColumnProfile => ({
  ...base,
  name: "dist",
  outputName: "dist",
  detectedType: "float",
  type: "float",
  status: "ok",
  mode: "match_mean_sd",
  summary: { kind: "numeric", min: 0, max: 10, mean: 4, sd: 2, decimals: 2, quantiles: new Array(101).fill(1), histogram: new Array(20).fill(1) },
  ...over,
});
const categorical = (over: Partial<ColumnProfile> = {}): ColumnProfile => ({
  ...base,
  name: "mode",
  outputName: "mode",
  detectedType: "categorical",
  type: "categorical",
  status: "ok",
  summary: { kind: "categorical", storage: "integer", counts: { "1": 10, "2": 5 } },
  ...over,
});
const unsupported = (name = "email"): ColumnProfile => ({ ...base, name, outputName: name, detectedType: "unsupported", type: "unsupported", status: "unsupported", exclude: "drop", summary: { kind: "unsupported" } });

describe("local edits", () => {
  it("changes nothing without edits", () => {
    const p = numeric();
    expect(applyEdits(p, undefined)).toBe(p);
    expect(applyEdits(p, {})).toEqual(p);
  });

  it("leaves a column out or keeps it as all-missing", () => {
    expect(applyEdits(numeric(), { exclude: "drop" }).exclude).toBe("drop");
    expect(applyEdits(numeric(), { exclude: "keep_as_na" }).exclude).toBe("keep_as_na");
    expect(applyEdits(categorical({ exclude: "drop" }), { exclude: "include" }).exclude).toBe("include");
  });

  it("never includes a column that cannot be generated", () => {
    expect(applyEdits(unsupported(), { exclude: "include" }).exclude).toBe("drop");
    expect(applyEdits(unsupported(), { exclude: "keep_as_na" }).exclude).toBe("keep_as_na");
  });

  it("sets the numeric mode and decimals", () => {
    const p = applyEdits(numeric(), { mode: "match_shape", decimals: 4 });
    expect(p.mode).toBe("match_shape");
    expect(p.summary.kind === "numeric" && p.summary.decimals).toBe(4);
  });

  it("keeps decimals between 0 and 15 and whole", () => {
    expect(applyEdits(numeric(), { decimals: 99 }).summary).toMatchObject({ decimals: 15 });
    expect(applyEdits(numeric(), { decimals: -3 }).summary).toMatchObject({ decimals: 0 });
    expect(applyEdits(numeric(), { decimals: 2.6 }).summary).toMatchObject({ decimals: 3 });
  });

  it("does not give an integer column decimals", () => {
    const integer = numeric({ type: "integer", detectedType: "integer" });
    expect(applyEdits(integer, { decimals: 3 }).summary).toMatchObject({ decimals: 2 });
  });

  it("allows the rescale only when the mode is match mean and sd", () => {
    expect(applyEdits(numeric(), { rescale: true }).rescale).toBe(true);
    expect(applyEdits(numeric(), { rescale: true, mode: "uniform" }).rescale).toBe(false);
    expect(applyEdits(numeric({ mode: "match_shape" }), { rescale: true }).rescale).toBe(false);
  });

  it("sets the label protections on categorical columns only", () => {
    const p = applyEdits(categorical(), { mergeUnderK: 5, labelCodes: true });
    expect(p.mergeUnderK).toBe(5);
    expect(p.labelCodes).toBe(true);
    expect(applyEdits(numeric(), { mergeUnderK: 5, labelCodes: true }).labelCodes).toBeUndefined();
    expect(applyEdits(categorical(), { mergeUnderK: null }).mergeUnderK).toBeNull();
  });

  it("renames the output column, ignoring a blank name", () => {
    expect(applyEdits(categorical(), { outputName: "travel_mode" }).outputName).toBe("travel_mode");
    expect(applyEdits(categorical(), { outputName: "  " }).outputName).toBe("mode");
  });

  it("ignores edits that do not fit the column instead of failing", () => {
    expect(applyEdits(categorical(), { mode: "uniform", decimals: 3, rescale: true })).toEqual(categorical());
  });

  it("applies each column's own edits in order", () => {
    const out = applyAllEdits([numeric(), categorical()], { dist: { exclude: "drop" }, mode: { labelCodes: true } });
    expect(out.map((p) => p.exclude)).toEqual(["drop", "include"]);
    expect(out[1].labelCodes).toBe(true);
  });
});

describe("parsing a typed list", () => {
  it("trims, drops blanks and repeats", () => {
    expect(parseList("-9, 998 ,, 999, -9")).toEqual(["-9", "998", "999"]);
    expect(parseList("")).toEqual([]);
    expect(parseList("   ")).toEqual([]);
    expect(parseList("NA")).toEqual(["NA"]);
  });
});

describe("column filters", () => {
  const list = [
    numeric({ name: "trip_dist_mi", outputName: "trip_dist_mi" }),
    categorical({ name: "mode", outputName: "mode" }),
    categorical({ name: "purpose", outputName: "purpose", status: "needs_attention" }),
    unsupported("email"),
  ];

  it("shows everything with no filter", () => {
    expect(filterProfiles(list, NO_FILTERS)).toHaveLength(4);
    expect(isFiltering(NO_FILTERS)).toBe(false);
  });

  it("searches names ignoring case and matching part of a name", () => {
    expect(filterProfiles(list, { ...NO_FILTERS, query: "DIST" }).map((p) => p.name)).toEqual(["trip_dist_mi"]);
    expect(filterProfiles(list, { ...NO_FILTERS, query: "  pur " }).map((p) => p.name)).toEqual(["purpose"]);
    expect(filterProfiles(list, { ...NO_FILTERS, query: "zzz" })).toEqual([]);
  });

  it("also searches the renamed output name", () => {
    const renamed = [categorical({ name: "mode", outputName: "travel_mode" })];
    expect(filterProfiles(renamed, { ...NO_FILTERS, query: "travel" })).toHaveLength(1);
  });

  it("filters to columns that need a look, including unsupported ones", () => {
    expect(filterProfiles(list, { ...NO_FILTERS, attentionOnly: true }).map((p) => p.name)).toEqual(["purpose", "email"]);
  });

  it("filters by type", () => {
    expect(filterProfiles(list, { ...NO_FILTERS, type: "categorical" }).map((p) => p.name)).toEqual(["mode", "purpose"]);
    expect(filterProfiles(list, { ...NO_FILTERS, type: "unsupported" }).map((p) => p.name)).toEqual(["email"]);
  });

  it("combines the search and both filters", () => {
    expect(filterProfiles(list, { query: "p", attentionOnly: true, type: "categorical" }).map((p) => p.name)).toEqual(["purpose"]);
  });

  it("counts columns per type", () => {
    expect(countByType(list)).toEqual({ float: 1, categorical: 2, unsupported: 1 });
  });

  it("knows when a filter is on", () => {
    expect(isFiltering({ ...NO_FILTERS, query: "a" })).toBe(true);
    expect(isFiltering({ ...NO_FILTERS, attentionOnly: true })).toBe(true);
    expect(isFiltering({ ...NO_FILTERS, type: "float" })).toBe(true);
    expect(isFiltering({ ...NO_FILTERS, query: "  " })).toBe(false);
  });
});
