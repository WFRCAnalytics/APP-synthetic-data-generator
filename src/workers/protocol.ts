// Typed messages between the UI thread and the two workers (contracts/worker-protocol.md).
// No message ever carries a real data row. Error messages come from lib/errors.ts and never hold a
// cell value.

import type { SampleDescription } from "../lib/textgen/sample";
import type { WireError } from "../lib/errors";
import type { ColumnOverrides, ColumnProfile, FileSettings, SourceSettings } from "../lib/profile/types";
import type { SheetHints, WorkbookInfo } from "../lib/xlsx/metadata";
import type { CheckRow } from "../lib/generate/checks";
import type { SpecFile } from "../lib/spec/types";

// ---- Profile worker (owns DuckDB and the real data) -----------------------------------------

export type ProfileRequest =
  | { type: "open"; file: File }
  | { type: "load"; settings: FileSettings }
  /** Inspect a workbook's packaging: sheet names, visibility, date system. No cell value is read. */
  | { type: "inspectSheet"; sheet: string }
  | { type: "loadSheet"; sheet: string; range?: string; skipRows: number; header: boolean; date1904: boolean }
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
  | { type: "done"; totalBytes: number; replaced: number }
  | { type: "samples"; id: number; values: string[] }
  | { type: "error"; error: WireError };
