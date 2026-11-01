// Types for what profiling produces and the user edits (data-model.md). These hold summaries only;
// real rows never appear in them (constitution Principle I).

import type { ColumnType, ExcludeMode, Granularity, MaskToken, NumericMode, PersonalFormat, PersonalKind } from "../spec/types";
import type { Encoding } from "../encoding/detect";
import type { ParquetType, UnsupportedReason } from "../parquet/types";
import type { QuoteStyle, LineEnding } from "../csv/writer";

export type { ColumnType, ExcludeMode, Granularity, MaskToken, NumericMode, PersonalFormat, PersonalKind };

export interface FileSettings {
  encoding: Encoding;
  bom: boolean;
  delimiter: string;
  quote: string | null;
  quoteStyle: QuoteStyle;
  lineEnding: LineEnding;
  header: boolean;
  /** Whether the header row's names were quoted in the source. */
  headerQuoted: boolean;
  trailingNewline: boolean;
}

/** How a worksheet of an .xlsx workbook is read (specs/003). The sheet name is the only text from the workbook. */
export interface ExcelSettings {
  sheet: string;
  /** Cell range of the table from the header row, such as A3:I203; absent means the used range. */
  range?: string;
  /** Rows above the header (also the first row of `range`, minus one). */
  skipRows: number;
  header: boolean;
  date1904: boolean;
}

/** A Parquet file (specs/005): its settings are structure only. */
export interface ParquetSettings {
  parquet: true;
  rowGroups: number;
}

/** What a file is read with: CSV settings, the settings of one worksheet, or those of a Parquet file. */
export type SourceSettings = FileSettings | ExcelSettings | ParquetSettings;
export const isExcelSettings = (s: SourceSettings): s is ExcelSettings => "sheet" in s;
export const isParquetSettings = (s: SourceSettings): s is ParquetSettings => "parquet" in s;

export type ColumnStatus = "ok" | "needs_attention" | "unsupported";

export type ReasonCode =
  | "possible_identifier"
  | "possible_sentinel"
  | "near_categorical_threshold"
  | "date_format_unrecognized"
  | "date_format_mixed"
  | "date_format_ambiguous"
  | "id_mask_too_narrow"
  | "id_mixed_masks"
  | "possible_na_token"
  | "id_not_yet_supported"
  | "override_not_possible"
  | "beta_fit_failed"
  | "mixed_cells"
  | "merged_cells"
  | "format_mismatch"
  | "sheet_hidden"
  | "kind_mixed"
  | "suffix_needed"
  | "ssn_needs_acknowledgement"
  | "text_length_capped"
  | "needs_source_file"
  | "unsupported_type";

/** The numeric part shared by integer, float, date, datetime and time summaries. */
export interface NumericSummary {
  min: number;
  max: number;
  mean: number;
  sd: number;
  decimals: number;
  /** 101 values, 1% steps. */
  quantiles: number[];
  /** 20 bin counts, used only for the card chart. */
  histogram: number[];
  /** Integers written with thousands separators (1,234). */
  thousands?: boolean;
  /** Numbers written in scientific notation (1.2e-5). */
  scientific?: boolean;
}

export type ColumnSummary =
  | { kind: "categorical"; storage: "integer" | "string"; counts: Record<string, number> }
  | ({ kind: "numeric" } & NumericSummary)
  | ({ kind: "datetime"; format: string | null; granularity: Granularity } & NumericSummary)
  | {
      kind: "survey_id";
      mask: MaskToken[];
      min?: number;
      max?: number;
      padWidth?: number;
      /** Group size to number of distinct IDs with that size. */
      repeatStructure: Record<string, number>;
      distinct: number;
    }
  | {
      kind: "personal";
      personalKind: PersonalKind;
      /** Group size to the number of distinct values with that size. */
      repeatStructure: Record<string, number>;
      distinct: number;
      format?: PersonalFormat;
    }
  | (Omit<NumericSummary, "thousands" | "scientific"> & { kind: "free_text"; lineBreaks: boolean })
  | {
      kind: "short_string";
      pattern: MaskToken[];
      /** Length to the number of distinct values of that length. */
      lengthGroups: Record<string, number>;
      repeatStructure: Record<string, number>;
      distinct: number;
    }
  | { kind: "empty" }
  | { kind: "unsupported" };

/**
 * Settings the user can change on the Review screen that need the data to take effect, so the
 * profile worker recomputes the column with them (FR-005 to FR-008).
 */
export interface ColumnOverrides {
  /** Confirmed sentinel codes, replacing the proposed ones. */
  sentinels?: string[];
  /** The tokens that mean "missing" for this column (the empty field always does), replacing the defaults. */
  naTokens?: string[];
  /** A date pattern typed by the user. */
  datePattern?: string;
  /** A type chosen by the user instead of the detected one. */
  type?: ColumnType;
}

export interface ColumnProfile {
  name: string;
  outputName: string;
  detectedType: ColumnType;
  type: ColumnType;
  status: ColumnStatus;
  attentionReasons: ReasonCode[];
  naTokens: string[];
  naCount: number;
  /** Rows per NA token (the empty field is the token ""). */
  naByToken: Record<string, number>;
  sentinels: Record<string, number>;
  exclude: ExcludeMode;
  /** Whether the source wrote this column's non-empty fields in quotes. */
  quoted: boolean;
  mode?: NumericMode;
  /** Restore the exact mean and sd after rounding (optional, FR-027). */
  rescale?: boolean;
  /** Merge categories with fewer than this many rows into "Other" (off when null or absent). */
  mergeUnderK?: number | null;
  /** Replace category labels with neutral codes. */
  labelCodes?: boolean;
  /** Only for SSN-style columns: the user accepted generating invented numbers. */
  acknowledged?: boolean;
  /** The number format code of the column's cells in a workbook (a format, never a value). */
  cellFormat?: string;
  /** The real cells held text although the values read as numbers or dates. */
  storedAsText?: boolean;
  /** The column's logical type in a Parquet file. */
  parquetType?: ParquetType;
  /** Why a Parquet column cannot be faked (list, struct, map and so on). */
  unsupportedReason?: UnsupportedReason;
  summary: ColumnSummary;
}
