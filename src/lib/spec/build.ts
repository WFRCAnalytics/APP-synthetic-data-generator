// Builds the spec file from the reviewed column profiles (FR-017). The spec holds only what the
// privacy model allows: category labels and counts, exact min and max, sentinel codes, quantiles,
// masks and repeat structures, and format settings. An unsupported column keeps only its name and
// the user's choice, so none of its values can leak (constitution Principle II).

import { fitKind } from "../json/kinds";
import {
  isExcelSettings,
  isJsonSettings,
  isParquetSettings,
  type ColumnProfile,
  type SourceSettings,
} from "../profile/types";
import {
  SPEC_VERSION,
  type ColumnSpec,
  type NumericFields,
  type SourceSpec,
  type SpecFile,
} from "./types";

export interface BuildInput {
  fileName: string;
  settings: SourceSettings;
  rowCount: number;
  seed: number;
  keepOriginalName: boolean;
  threshold: number;
  profiles: readonly ColumnProfile[];
}

export function buildSource(fileName: string, s: SourceSettings): SourceSpec {
  if (isParquetSettings(s))
    return { format: "parquet", file_name: fileName, row_groups: s.rowGroups };
  if (isJsonSettings(s)) {
    const l = s.layout;
    return {
      format: "json",
      file_name: fileName,
      form: l.form,
      indent: l.indent,
      line_ending: l.lineEnding,
      trailing_newline: l.trailingNewline,
      bom: l.bom,
    };
  }
  if (isExcelSettings(s)) {
    return {
      format: "xlsx",
      file_name: fileName,
      sheet: s.sheet,
      ...(s.range ? { range: s.range } : {}),
      skip_rows: s.skipRows,
      header: s.header,
      date1904: s.date1904,
    };
  }
  return {
    format: "csv",
    file_name: fileName,
    encoding: s.encoding,
    bom: s.bom,
    delimiter: s.delimiter,
    quote: s.quote,
    quote_style: s.quoteStyle,
    line_ending: s.lineEnding,
    trailing_newline: s.trailingNewline,
    header: s.header,
    header_quoted: s.headerQuoted,
  };
}

function numericFields(p: ColumnProfile): NumericFields | null {
  const s = p.summary;
  if (s.kind !== "numeric" && s.kind !== "datetime") return null;
  return {
    mode: p.mode ?? "match_mean_sd",
    min: s.min,
    max: s.max,
    mean: s.mean,
    sd: s.sd,
    decimals: s.decimals,
    quantiles: s.quantiles,
    ...(p.rescale ? { rescale: true } : {}),
  };
}

/** One profile as a spec column. */
export function columnSpecOf(p: ColumnProfile): ColumnSpec {
  const c = baseColumnSpec(p);
  if (c.json_kind === undefined) return c;
  // The kind the file had, made to suit the type the user chose; the absent keys cannot outnumber the missing cells.
  const token = c.na?.tokens[0] ?? "";
  const missingCells = c.na ? (c.na.by_token ? (c.na.by_token[token] ?? 0) : c.na.count) : 0;
  return {
    ...c,
    json_kind: fitKind(c.json_kind, c.type),
    json_missing: Math.min(c.json_missing ?? 0, missingCells),
  };
}

function baseColumnSpec(p: ColumnProfile): ColumnSpec {
  const common = {
    name: p.name,
    ...(p.cellFormat ? { cell_format: p.cellFormat } : {}),
    ...(p.storedAsText ? { stored_as_text: true } : {}),
    ...(p.parquetType ? { parquet_type: p.parquetType } : {}),
    ...(p.jsonKind ? { json_kind: p.jsonKind, json_missing: p.jsonMissing ?? 0 } : {}),
    ...(p.valueLabels && Object.keys(p.valueLabels).length > 0
      ? { value_labels: p.valueLabels }
      : {}),
    ...(p.outputName !== p.name ? { output_name: p.outputName } : {}),
    ...(p.exclude !== "include" ? { exclude: p.exclude } : {}),
  };

  const s = p.summary;

  // Unsupported columns: a name and a choice, nothing else.
  if (p.type === "unsupported" || s.kind === "unsupported")
    return { ...common, type: "unsupported" };
  // Survey IDs without a mask yet (until ID patterns land) are held back the same way.
  if (p.type === "survey_id" && s.kind === "survey_id" && s.mask.length === 0)
    return { ...common, type: "unsupported" };

  const detail = {
    ...common,
    quoted: p.quoted,
    ...(p.naTokens.length > 0
      ? {
          na: {
            tokens: p.naTokens,
            count: p.naCount,
            ...(p.naTokens.length > 1 ? { by_token: p.naByToken } : {}),
          },
        }
      : {}),
    ...(Object.keys(p.sentinels).length > 0 ? { sentinels: p.sentinels } : {}),
  };

  switch (s.kind) {
    case "empty":
      return { ...detail, type: "empty" };
    case "categorical":
      return {
        ...detail,
        type: p.type === "boolean" ? "boolean" : "categorical",
        storage: s.storage,
        counts: s.counts,
        ...(p.mergeUnderK ? { merge_under_k: p.mergeUnderK } : {}),
        ...(p.labelCodes ? { label_codes: true } : {}),
      };
    case "numeric":
      return {
        ...detail,
        type: p.type as "integer" | "float",
        ...(numericFields(p) as NumericFields),
        ...(s.thousands ? { thousands: true } : {}),
        ...(s.scientific ? { scientific: true } : {}),
      };
    case "datetime":
      return {
        ...detail,
        type: p.type as "date" | "datetime" | "time",
        ...(numericFields(p) as NumericFields),
        format: s.format ?? "",
        granularity: s.granularity,
      };
    case "personal":
      return {
        ...detail,
        type: "personal",
        kind: s.personalKind,
        repeat_structure: s.repeatStructure,
        ...(s.format && Object.keys(s.format).length > 0 ? { format: s.format } : {}),
        ...(s.personalKind === "ssn" && p.acknowledged ? { acknowledged: true } : {}),
      };
    case "free_text": {
      const { histogram: _histogram, ...length } = s;
      void _histogram;
      return {
        ...detail,
        type: "free_text",
        mode: p.mode ?? "match_mean_sd",
        min: length.min,
        max: length.max,
        mean: length.mean,
        sd: length.sd,
        decimals: 0,
        quantiles: length.quantiles,
        ...(p.rescale ? { rescale: true } : {}),
        line_breaks: s.lineBreaks,
      };
    }
    case "short_string":
      return {
        ...detail,
        type: "short_string",
        pattern: s.pattern,
        length_groups: s.lengthGroups,
        repeat_structure: s.repeatStructure,
      };
    case "survey_id":
      return {
        ...detail,
        type: "survey_id",
        mask: s.mask,
        ...(s.min !== undefined ? { min: s.min } : {}),
        ...(s.max !== undefined ? { max: s.max } : {}),
        ...(s.padWidth !== undefined ? { pad_width: s.padWidth } : {}),
        repeat_structure: s.repeatStructure,
      };
  }
}

export function buildSpec(input: BuildInput): SpecFile {
  return {
    spec_version: SPEC_VERSION,
    source: buildSource(input.fileName, input.settings),
    n_rows: input.rowCount,
    seed: input.seed,
    keep_original_name: input.keepOriginalName,
    categorical_threshold: input.threshold,
    columns: input.profiles.map(columnSpecOf),
  };
}
