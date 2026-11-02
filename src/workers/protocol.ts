// Typed messages between the UI thread and the two workers (contracts/worker-protocol.md).
// No message ever carries a real data row. Error messages come from lib/errors.ts and never hold a
// cell value.

import type { SampleDescription } from "../lib/textgen/sample";
import type { WireError } from "../lib/errors";
import type { ColumnOverrides, ColumnProfile, FileSettings, SourceSettings } from "../lib/profile/types";
import type { SheetHints, WorkbookInfo } from "../lib/xlsx/metadata";
import type { StatFormat } from "../lib/stat/detect";
import type { JsonKind, JsonLayout, JsonUnsupportedReason } from "../lib/json/types";
import type { ParquetType, UnsupportedReason } from "../lib/parquet/types";
import type { CheckRow } from "../lib/generate/checks";
import type { SpecFile } from "../lib/spec/types";

/** What the page may know of a Parquet file before it is profiled. */
export interface ParquetSummary {
  rowCount: number;
  rowGroups: number;
  /** The size of the data once opened, in bytes, from the file's own sizes. */
  expandedBytes: number;
  columns: { name: string; type: ParquetType | null; unsupported: UnsupportedReason | null; renamed: boolean }[];
}

/** What the page may know of an SPSS or Stata file before it is profiled: structure only, never a value or a label (specs/017). */
export interface StatSummary {
  format: StatFormat;
  /** The name of the file as chosen; the table itself is known by the CSV name made from it. */
  sourceName: string;
  rowCount: number;
  expandedBytes: number;
  columns: { name: string; kind: "number" | "text" | "date" | "datetime" }[];
}

/** What the page may know of a JSON file before it is profiled: structure only, never a value or a nested key name. */
export interface JsonSummary {
  rowCount: number;
  layout: JsonLayout;
  /** An estimate of the data once opened, in bytes, from the file's size. */
  expandedBytes: number;
  keys: { name: string; kind: JsonKind; nulls: number; missing: number; mixed: boolean; unsupported: JsonUnsupportedReason | null; renamed: boolean }[];
}

// ---- Profile worker (owns DuckDB and the real data) -----------------------------------------

export type ProfileRequest =
  | { type: "open"; file: File }
  | { type: "load"; settings: FileSettings }
  /** Inspect a workbook's packaging: sheet names, visibility, date system. No cell value is read. */
  | { type: "inspectSheet"; sheet: string }
  | { type: "loadSheet"; sheet: string; range?: string; skipRows: number; header: boolean; date1904: boolean }
  /** Load the Parquet file that was opened (specs/005). */
  | { type: "loadParquet" }
  /** Load the JSON file that was opened (specs/007). */
  | { type: "loadJson" }
  /** Load the SPSS or Stata file that was opened (specs/017). */
  | { type: "loadStat" }
  | { type: "profile"; threshold: number; overrides?: Record<string, ColumnOverrides> }
  | { type: "reprofile"; column: string; overrides: ColumnOverrides }
  | { type: "datePattern"; column: string; pattern: string }
  | { type: "cancel" };

export type ProfileJob = "open" | "load" | "profile" | "reprofile";

export type ProfileResponse =
  | {
      type: "settingsDetected";
      settings: FileSettings;
      confidence: "high" | "medium" | "low";
      /** Names only (never values), so the user can confirm the header setting. */
      columnNames: string[];
      fileName: string;
      fileSize: number;
    }
  /** The chosen file is a workbook: its sheets, never a cell value (specs/003). */
  | { type: "workbookInfo"; info: WorkbookInfo; fileName: string; fileSize: number }
  | { type: "sheetHints"; sheet: string; hints: SheetHints }
  /** The chosen file is a Parquet file: its structure, never a value or a piece of its metadata (specs/005). */
  | { type: "parquetInfo"; info: ParquetSummary; fileName: string; fileSize: number }
  /** The chosen file is a JSON file: its structure, never a value (specs/007). */
  | { type: "jsonInfo"; info: JsonSummary; fileName: string; fileSize: number }
  /** The chosen file is an SPSS or Stata file: its structure, never a value (specs/017). */
  | { type: "statInfo"; info: StatSummary; fileName: string; fileSize: number }
  | { type: "loaded"; rowCount: number; columnNames: string[]; settings: SourceSettings }
  | { type: "progress"; job: ProfileJob; done: number; total: number }
  | { type: "columnProfile"; profile: ColumnProfile }
  | { type: "profiled"; count: number }
  | { type: "datePatternResult"; column: string; parsed: number; total: number }
  | { type: "error"; error: WireError };

// ---- Generate worker (spec only, no DuckDB) -------------------------------------------------

export type { CheckRow };

export type GenerateRequest =
  | { type: "generate"; spec: SpecFile; seed: number; chunkRows: number }
  /** A few invented values for a column description (live samples on Review). Holds no real value. */
  | { type: "sample"; id: number; description: SampleDescription; count: number; seed: number }
  | { type: "cancel" };

export type GenerateResponse =
  | { type: "preview"; header: string[]; rows: string[][] }
  | { type: "chunk"; bytes: ArrayBuffer }
  | { type: "progress"; rowsDone: number; rowsTotal: number }
  | { type: "checks"; checks: CheckRow[] }
  /** `codec` is how a Parquet file's pages are compressed ("gzip" or "none"); absent for other formats. */
  | { type: "done"; totalBytes: number; replaced: number; codec?: "gzip" | "none" }
  | { type: "samples"; id: number; values: string[] }
  | { type: "error"; error: WireError };
