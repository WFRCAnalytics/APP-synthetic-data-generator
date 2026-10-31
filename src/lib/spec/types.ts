// Types for the spec file (contracts/spec-file.schema.json, data-model.md). The spec is the only
// artifact derived from real data: category labels, exact min and max, sentinel codes, quantiles,
// ID pattern masks and repeat structures, and format settings. Never rows, ID lists, free text,
// personal identifiers or coordinates (constitution Principle II).

export const SPEC_VERSION = 1;

export type ColumnType =
  | "empty"
  | "boolean"
  | "categorical"
  | "integer"
  | "float"
  | "date"
  | "datetime"
  | "time"
  | "survey_id"
  | "unsupported";

export type NumericMode = "uniform" | "match_mean_sd" | "match_shape";
export type ExcludeMode = "drop" | "keep_as_na" | "include";
export type Granularity = "day" | "minute" | "second";

/**
 * One position of an ID pattern: a class of characters, or one fixed literal character.
 * digit 0-9; upper A-Z; lower a-z; letter A-Z or a-z; alnum digits and both cases of letters.
 */
export type MaskToken = "digit" | "upper" | "lower" | "letter" | "alnum" | { literal: string };

export interface SourceSpec {
  format: "csv";
  file_name: string;
  encoding: "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";
  bom?: boolean;
  delimiter: string;
  quote?: string | null;
  quote_style?: "minimal" | "all" | "per_column";
  line_ending?: "lf" | "crlf" | "cr";
  trailing_newline?: boolean;
  header: boolean;
  /** Whether the header row's names were quoted in the source. */
  header_quoted?: boolean;
}

export interface NaSpec {
  tokens: string[];
  /** Total NA rows. */
  count: number;
  /** Rows per token, when a column uses more than one. Must add up to count. */
  by_token?: Record<string, number>;
}

export interface ColumnBase {
  name: string;
  output_name?: string;
  exclude?: ExcludeMode;
  /** Whether the source quoted this column's non-empty fields (used by per_column quoting). */
  quoted?: boolean;
  na?: NaSpec;
  /** Sentinel code to exact count. */
  sentinels?: Record<string, number>;
}

export interface NumericFields {
  mode: NumericMode;
  min: number;
  max: number;
  mean?: number;
  sd?: number;
  decimals?: number;
  /** 101 non-decreasing values, 1% steps, used by match_shape. */
  quantiles?: number[];
  rescale?: boolean;
  /** The source wrote integers with thousands separators (1,234); the export does too. */
  thousands?: boolean;
  /** The source wrote numbers in scientific notation (1.2e-5); the export does too. */
  scientific?: boolean;
}

export interface CategoricalColumn extends ColumnBase {
  type: "categorical" | "boolean";
  storage?: "integer" | "string";
  /** Label to count. Real labels are allowed by the privacy model. */
  counts: Record<string, number>;
  merge_under_k?: number | null;
  label_codes?: boolean;
}

export interface NumericColumn extends ColumnBase, NumericFields {
  type: "integer" | "float";
}

export interface DateColumn extends ColumnBase, NumericFields {
  type: "date" | "datetime" | "time";
  format: string;
  granularity: Granularity;
}

export interface SurveyIdColumn extends ColumnBase {
  type: "survey_id";
  mask: MaskToken[];
  min?: number;
  max?: number;
  pad_width?: number;
  /** Group size (as a string key) to the number of distinct IDs with that size. */
  repeat_structure: Record<string, number>;
}

export interface EmptyColumn extends ColumnBase {
  type: "empty";
}

/** A column this version cannot generate: only its name and the user's choice are kept. */
export interface UnsupportedColumn extends ColumnBase {
  type: "unsupported";
}

export type ColumnSpec =
  | CategoricalColumn
  | NumericColumn
  | DateColumn
  | SurveyIdColumn
  | EmptyColumn
  | UnsupportedColumn;

export interface SpecFile {
  spec_version: number;
  source: SourceSpec;
  n_rows: number;
  seed: number;
  keep_original_name?: boolean;
  categorical_threshold?: number;
  columns: ColumnSpec[];
}

/** A problem found while validating a spec, named by column where there is one. */
export interface SpecProblem {
  column: string | null;
  path: string;
  message: string;
}

export type SpecResult = { ok: true; spec: SpecFile } | { ok: false; problems: SpecProblem[] };
