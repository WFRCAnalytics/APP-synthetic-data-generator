// Typed messages between the UI thread and the two workers (contracts/worker-protocol.md).
// No message ever carries a real data row. Error messages come from lib/errors.ts and never hold a
// cell value.

import type { WireError } from "../lib/errors";
import type { ColumnProfile, FileSettings } from "../lib/profile/types";
import type { SpecFile } from "../lib/spec/types";

// ---- Profile worker (owns DuckDB and the real data) -----------------------------------------

export type ProfileRequest =
  | { type: "open"; file: File }
  | { type: "load"; settings: FileSettings }
  | { type: "profile"; threshold: number }
  | { type: "reprofile"; column: string; overrides: Record<string, unknown> }
  | { type: "datePattern"; column: string; pattern: string }
  | { type: "cancel" };

export type ProfileJob = "open" | "load" | "profile" | "reprofile";

export type ProfileResponse =
  | { type: "settingsDetected"; settings: FileSettings; confidence: "high" | "medium" | "low" }
  | { type: "loaded"; rowCount: number; columnNames: string[] }
  | { type: "progress"; job: ProfileJob; done: number; total: number }
  | { type: "columnProfile"; profile: ColumnProfile }
  | { type: "datePatternResult"; column: string; parsed: number; total: number }
  | { type: "net"; url: string; sameOrigin: boolean }
  | { type: "error"; error: WireError };

// ---- Generate worker (spec only, no DuckDB) -------------------------------------------------

export interface CheckRow {
  column: string;
  metric: "label_counts" | "na_count" | "sentinel_counts" | "min" | "max" | "mean" | "sd" | "repeat_structure";
  target: string;
  achieved: string;
  /** Exact metrics must be equal; mean and sd report a difference instead of failing. */
  pass: boolean;
}

export type GenerateRequest =
  | { type: "generate"; spec: SpecFile; seed: number; chunkRows: number }
  | { type: "cancel" };

export type GenerateResponse =
  | { type: "preview"; header: string[]; rows: string[][] }
  | { type: "chunk"; bytes: ArrayBuffer }
  | { type: "progress"; rowsDone: number; rowsTotal: number }
  | { type: "checks"; checks: CheckRow[] }
  | { type: "done"; totalBytes: number }
  | { type: "net"; url: string; sameOrigin: boolean }
  | { type: "error"; error: WireError };
