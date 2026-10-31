// Types for what profiling produces and the user edits (data-model.md). These hold summaries only;
// real rows never appear in them (constitution Principle I).

import type { ColumnType, ExcludeMode, Granularity, MaskToken, NumericMode } from "../spec/types";
import type { Encoding } from "../encoding/detect";
import type { QuoteStyle, LineEnding } from "../csv/writer";

export type { ColumnType, ExcludeMode, Granularity, MaskToken, NumericMode };

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
  | "beta_fit_failed"
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
  | { kind: "empty" }
  | { kind: "unsupported" };

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
  summary: ColumnSummary;
}
