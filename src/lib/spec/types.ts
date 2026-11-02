// Types for the spec file (contracts/spec-file.schema.json, data-model.md). The spec is the only
// artifact derived from real data: category labels, exact min and max, sentinel codes, quantiles,
// ID pattern masks and repeat structures, and format settings. Never rows, ID lists, free text,
// personal identifiers or coordinates (constitution Principle II).

import type { CoordinateAxis } from "../classify/coordinate";
import type { RuleSpec } from "../rules/types";
import type { PersonalLocale } from "../textgen/locales";
import type { JsonForm, JsonIndent, JsonKind, JsonLineEnding } from "../json/types";
import type { ParquetType } from "../parquet/types";

/** The version this app writes. Version 2 added the personal, free_text and short_string types; version 3 the xlsx source; version 4 the parquet source; version 5 the json source (no older version is read while the app is in beta). */
export const SPEC_VERSION = 5;
/** The versions this app reads. */
export const READABLE_SPEC_VERSIONS: readonly number[] = [5];

/**
 * In `na.tokens`, the token for a cell that holds empty text (as opposed to "" for a blank cell). It is
 * one control character that no real value holds, so it cannot be mistaken for a label.
 */
export const EMPTY_TEXT_TOKEN = "\u0001";

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
  | "personal"
  | "free_text"
  | "short_string"
  | "unsupported";

export type NumericMode = "uniform" | "match_mean_sd" | "match_shape";
export type ExcludeMode = "drop" | "keep_as_na" | "include";
export type Granularity = "day" | "minute" | "second";

/**
 * One position of an ID pattern: a class of characters, or one fixed literal character.
 * digit 0-9; upper A-Z; lower a-z; letter A-Z or a-z; alnum digits and both cases of letters.
 */
export type MaskToken = "digit" | "upper" | "lower" | "letter" | "alnum" | { literal: string };

export interface CsvSourceSpec {
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

/** A sheet of an .xlsx workbook (specs/003). Nothing here is a cell value. */
export interface XlsxSourceSpec {
  format: "xlsx";
  file_name: string;
  /** Sheet name, exactly as in the workbook. */
  sheet: string;
  /** Cell range of the table, starting at the header row, such as A3:I203. */
  range?: string;
  /** Rows above the header, written empty in the fake sheet. */
  skip_rows: number;
  /** The first row of the range holds column names. */
  header: boolean;
  /** The workbook uses the 1904 date system. */
  date1904: boolean;
}

/** A Parquet file (specs/005). Structure only: nothing here is a value, statistic or piece of file metadata. */
export interface ParquetSourceSpec {
  format: "parquet";
  file_name: string;
  /** How many row groups the real file has. */
  row_groups: number;
}

/** A JSON file (specs/007). Structure only: the form and layout, never a value or a nested key name. */
export interface JsonSourceSpec {
  format: "json";
  file_name: string;
  /** An array of records, or one record per line. */
  form: JsonForm;
  /** Arrays only. */
  indent: JsonIndent;
  line_ending: JsonLineEnding;
  trailing_newline: boolean;
  bom: boolean;
}

export type SourceSpec = CsvSourceSpec | XlsxSourceSpec | ParquetSourceSpec | JsonSourceSpec;

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
  /** The number format code of the column's cells in a workbook, such as #,##0.00 or mm/dd/yyyy. Never a value. */
  cell_format?: string;
  /** The real cells held text even though the values read as numbers or dates (a zip code stored as text). The fake cells are text too. */
  stored_as_text?: boolean;
  /** The column's logical type in a Parquet file, enough to write the same schema back. Never a value. */
  parquet_type?: ParquetType;
  /** The JSON kind of the key in a JSON file, enough to write it back as the same kind. Never a value. */
  json_kind?: JsonKind;
  /** In how many records the key is absent (the rest of its missing values are null). Never a value. */
  json_missing?: number;
  na?: NaSpec;
  /** Sentinel code to exact count. */
  sentinels?: Record<string, number>;
  /** A coordinate (number columns only): the spec keeps only its bounding box and decimals, no mean, spread or percentiles, and values are spread evenly. */
  coordinate?: CoordinateAxis;
  /** What the codes of the column mean, from a codebook (value to short label). Documentation: the file still holds the codes. */
  value_labels?: Record<string, string>;
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

export type PersonalKind =
  "full_name" | "first_name" | "last_name" | "email" | "phone" | "address" | "url" | "ip" | "ssn";

/** Format classes kept from the real column. Shapes hold 9 for a digit and A for a letter; never a value. */
export interface PersonalFormat {
  shapes?: { shape: string; share: number }[];
  shape?: string;
  last_first?: boolean;
  unit?: boolean;
  zip4?: boolean;
}

/** A column of invented personal values (names, email, phone, address, ...). Holds no value. */
export interface PersonalColumn extends ColumnBase {
  type: "personal";
  kind: PersonalKind;
  /** The region the invented values come from; en_US when absent. */
  locale?: PersonalLocale;
  /** Group size (as a string key) to the number of distinct values with that size. */
  repeat_structure: Record<string, number>;
  format?: PersonalFormat;
  /** Only for kind "ssn": the user accepted generating invented SSN-style numbers. */
  acknowledged?: boolean;
}

/** Free text: only the length distribution, in characters. */
export interface FreeTextColumn
  extends ColumnBase, Omit<NumericFields, "thousands" | "scientific"> {
  type: "free_text";
  line_breaks?: boolean;
}

/** A short code-like string: a per-position pattern for the longest length, lengths and repeats. */
export interface ShortStringColumn extends ColumnBase {
  type: "short_string";
  pattern: MaskToken[];
  /** Length (as a string key) to the number of distinct values of that length. */
  length_groups: Record<string, number>;
  repeat_structure: Record<string, number>;
}

export const MAX_TEXT_LENGTH = 100000;
export const MAX_LENGTH_GROUPS = 64;

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
  | PersonalColumn
  | FreeTextColumn
  | ShortStringColumn
  | EmptyColumn
  | UnsupportedColumn;

export interface SpecFile {
  spec_version: number;
  source: SourceSpec;
  n_rows: number;
  seed: number;
  keep_original_name?: boolean;
  categorical_threshold?: number;
  /** Relations between columns that the person stated (specs/015). */
  rules?: RuleSpec[];
  columns: ColumnSpec[];
}

/** A problem found while validating a spec, named by column where there is one. */
export interface SpecProblem {
  column: string | null;
  path: string;
  message: string;
}

export type SpecResult = { ok: true; spec: SpecFile } | { ok: false; problems: SpecProblem[] };
