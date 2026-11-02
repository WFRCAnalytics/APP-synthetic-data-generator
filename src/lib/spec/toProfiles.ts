// Turns a loaded spec back into column profiles, so Review and Generate work the same way whether the
// columns were profiled from a file or read from a saved spec (FR-004, FR-018). A spec holds the
// summaries, not the data, so the card chart is redrawn from the quantiles.

import { groupsNeeded } from "../generate/survey-id";
import { idFit, shortStringFit } from "../profile/idCapacity";
import type { ColumnProfile, ReasonCode, SourceSettings } from "../profile/types";
import type { ColumnSpec, NumericFields, SourceSpec } from "./types";

const BINS = 20;

/** 20 bin counts for the card chart, from the 101 percentile values of the spec. */
export function histogramFromQuantiles(q: readonly number[], min: number, max: number): number[] {
  const bins = new Array<number>(BINS).fill(0);
  const width = max - min;
  for (const v of q) {
    const i =
      width > 0 ? Math.min(BINS - 1, Math.max(0, Math.floor(((v - min) / width) * BINS))) : 0;
    bins[i]++;
  }
  return bins;
}

const linearQuantiles = (min: number, max: number): number[] =>
  Array.from({ length: 101 }, (_, i) => min + ((max - min) * i) / 100);

export function settingsFromSource(s: SourceSpec): SourceSettings {
  if (s.format === "parquet") return { parquet: true, rowGroups: s.row_groups };
  if (s.format === "json")
    return {
      json: true,
      layout: {
        form: s.form,
        indent: s.indent,
        lineEnding: s.line_ending,
        trailingNewline: s.trailing_newline,
        bom: s.bom,
      },
    };
  if (s.format === "xlsx")
    return {
      sheet: s.sheet,
      ...(s.range ? { range: s.range } : {}),
      skipRows: s.skip_rows,
      header: s.header,
      date1904: s.date1904,
    };
  return {
    encoding: s.encoding,
    bom: s.bom ?? false,
    delimiter: s.delimiter,
    quote: s.quote === undefined ? '"' : s.quote,
    quoteStyle: s.quote_style ?? "minimal",
    lineEnding: s.line_ending ?? "lf",
    header: s.header,
    headerQuoted: s.header_quoted ?? false,
    trailingNewline: s.trailing_newline ?? true,
  };
}

function numericSummary(c: NumericFields) {
  const quantiles =
    c.quantiles && c.quantiles.length === 101 ? [...c.quantiles] : linearQuantiles(c.min, c.max);
  return {
    min: c.min,
    max: c.max,
    mean: c.mean ?? (c.min + c.max) / 2,
    sd: c.sd ?? 0,
    decimals: c.decimals ?? 0,
    quantiles,
    histogram: histogramFromQuantiles(quantiles, c.min, c.max),
    ...(c.thousands ? { thousands: true } : {}),
    ...(c.scientific ? { scientific: true } : {}),
  };
}

export function profileFromSpec(c: ColumnSpec): ColumnProfile {
  const tokens = c.na?.tokens ?? [];
  const base = {
    name: c.name,
    outputName: c.output_name ?? c.name,
    naTokens: [...tokens],
    naCount: c.na?.count ?? 0,
    naByToken: c.na
      ? c.na.by_token
        ? { ...c.na.by_token }
        : { [tokens[0] ?? ""]: c.na.count }
      : {},
    sentinels: { ...(c.sentinels ?? {}) },
    quoted: c.quoted ?? false,
    ...(c.description ? { description: c.description } : {}),
    ...(c.value_labels ? { valueLabels: { ...c.value_labels } } : {}),
    ...(c.cell_format ? { cellFormat: c.cell_format } : {}),
    ...(c.stored_as_text ? { storedAsText: true } : {}),
    ...(c.parquet_type ? { parquetType: c.parquet_type } : {}),
    ...(c.json_kind ? { jsonKind: c.json_kind, jsonMissing: c.json_missing ?? 0 } : {}),
    attentionReasons: [] as ReasonCode[],
  };

  switch (c.type) {
    case "unsupported":
      return {
        ...base,
        detectedType: "unsupported",
        type: "unsupported",
        status: "unsupported",
        attentionReasons: ["unsupported_type"],
        exclude: c.exclude === "keep_as_na" ? "keep_as_na" : "drop",
        summary: { kind: "unsupported" },
      };
    case "empty":
      return {
        ...base,
        detectedType: "empty",
        type: "empty",
        status: "ok",
        exclude: c.exclude ?? "include",
        summary: { kind: "empty" },
      };
    case "categorical":
    case "boolean": {
      const labels = Object.keys(c.counts);
      const storage =
        c.storage ??
        (labels.length > 0 && labels.every((l) => /^-?\d+$/.test(l)) ? "integer" : "string");
      return {
        ...base,
        detectedType: c.type,
        type: c.type,
        status: "ok",
        exclude: c.exclude ?? "include",
        mergeUnderK: c.merge_under_k ?? null,
        labelCodes: c.label_codes ?? false,
        summary: { kind: "categorical", storage, counts: { ...c.counts } },
      };
    }
    case "integer":
    case "float":
      return {
        ...base,
        ...(c.coordinate ? { coordinate: c.coordinate } : {}),
        ...(c.child_count ? { childCount: c.child_count } : {}),
        detectedType: c.type,
        type: c.type,
        status: "ok",
        exclude: c.exclude ?? "include",
        mode: c.mode,
        rescale: c.rescale ?? false,
        summary: { kind: "numeric", ...numericSummary(c) },
      };
    case "date":
    case "datetime":
    case "time":
      return {
        ...base,
        detectedType: c.type,
        type: c.type,
        status: "ok",
        exclude: c.exclude ?? "include",
        mode: c.mode,
        rescale: c.rescale ?? false,
        summary: {
          kind: "datetime",
          format: c.format,
          granularity: c.granularity,
          ...numericSummary(c),
        },
      };
    case "personal": {
      const summary = {
        kind: "personal" as const,
        personalKind: c.kind,
        repeatStructure: { ...c.repeat_structure },
        distinct: groupsNeeded(c.repeat_structure),
        ...(c.format ? { format: c.format } : {}),
      };
      const unacknowledged = c.kind === "ssn" && c.acknowledged !== true;
      return {
        ...(c.locale ? { locale: c.locale } : {}),
        ...base,
        detectedType: "personal",
        type: unacknowledged ? "unsupported" : "personal",
        status: unacknowledged ? "unsupported" : "ok",
        attentionReasons: unacknowledged ? ["unsupported_type", "ssn_needs_acknowledgement"] : [],
        exclude: unacknowledged ? "drop" : (c.exclude ?? "include"),
        ...(c.kind === "ssn" ? { acknowledged: c.acknowledged === true } : {}),
        summary,
      };
    }
    case "free_text": {
      const quantiles =
        c.quantiles && c.quantiles.length === 101
          ? [...c.quantiles]
          : linearQuantiles(c.min, c.max);
      return {
        ...base,
        detectedType: "free_text",
        type: "free_text",
        status: "ok",
        exclude: c.exclude ?? "include",
        mode: c.mode,
        rescale: c.rescale ?? false,
        summary: {
          kind: "free_text",
          min: c.min,
          max: c.max,
          mean: c.mean ?? (c.min + c.max) / 2,
          sd: c.sd ?? 0,
          decimals: 0,
          quantiles,
          histogram: histogramFromQuantiles(quantiles, c.min, c.max),
          lineBreaks: c.line_breaks ?? false,
        },
      };
    }
    case "short_string": {
      const profile: ColumnProfile = {
        ...base,
        detectedType: "short_string",
        type: "short_string",
        status: "ok",
        exclude: c.exclude ?? "include",
        summary: {
          kind: "short_string",
          pattern: [...c.pattern],
          lengthGroups: { ...c.length_groups },
          repeatStructure: { ...c.repeat_structure },
          distinct: groupsNeeded(c.repeat_structure),
        },
      };
      if (shortStringFit(profile)?.short)
        return { ...profile, status: "needs_attention", attentionReasons: ["id_mask_too_narrow"] };
      return profile;
    }
    case "survey_id": {
      const profile: ColumnProfile = {
        ...(c.link ? { idLink: c.link } : {}),
        ...base,
        detectedType: "survey_id",
        type: "survey_id",
        status: "ok",
        exclude: c.exclude ?? "include",
        summary: {
          kind: "survey_id",
          mask: [...c.mask],
          min: c.min,
          max: c.max,
          padWidth: c.pad_width ?? 0,
          repeatStructure: { ...c.repeat_structure },
          distinct: groupsNeeded(c.repeat_structure),
        },
      };
      // A hand-edited spec may name a pattern that is too narrow for its repeat structure.
      if (!c.link && idFit(profile)?.short)
        return { ...profile, status: "needs_attention", attentionReasons: ["id_mask_too_narrow"] };
      return profile;
    }
  }
}

export const profilesFromSpec = (columns: readonly ColumnSpec[]): ColumnProfile[] =>
  columns.map(profileFromSpec);
