/// <reference lib="webworker" />
// The only place real data lives (constitution Principle I). It owns DuckDB-WASM, reads the file
// the user chose straight from the browser File, and posts back only summaries: settings, column
// names, counts and per-column profiles. Errors go through lib/errors.ts, which never carries a
// cell value. Messages are described in contracts/worker-protocol.md.

import { AppError, sanitizeError, toWireError } from "../lib/errors";
import { NET_CHANNEL } from "../lib/netChannel";
import { installNetPatch } from "./netpatch";
import type { ColumnProfile, FileSettings } from "../lib/profile/types";
import { createEngine, duckdb, type Engine } from "../lib/duckdb/engine";
import type { ProfileRequest, ProfileResponse } from "./protocol";
import { loadCsv } from "./profile/load";
import {
  columnNamesFor,
  detectFileSettings,
  detectQuotedColumns,
  HEAD_BYTES,
  quotingFor,
  TAIL_BYTES,
} from "./profile/open";
import { profileAll, profileColumn } from "./profile/profiler";
import { runnerFor } from "./profile/runner";
import type { SqlRunner } from "./profile/sql";
import { readModeFor, transcodeToUtf8 } from "./profile/transcode";

installNetPatch(NET_CHANNEL, self.location.origin);

const BASE = `${import.meta.env.BASE_URL}duckdb/`;

const post = (message: ProfileResponse) => self.postMessage(message);

let engine: Engine | null = null;
let sql: SqlRunner | null = null;
let file: File | null = null;
let head = new Uint8Array(0);
let settings: FileSettings | null = null;
let columnNames: string[] = [];
let quoted: boolean[] = [];
let rowCount = 0;
let threshold = 50;
let cancelled = false;

async function ensureEngine(): Promise<SqlRunner> {
  if (!engine) {
    engine = await createEngine(BASE);
    sql = runnerFor(await engine.db.connect());
  }
  return sql as SqlRunner;
}

async function open(chosen: File): Promise<void> {
  file = chosen;
  const size = chosen.size;
  if (size === 0) throw new AppError("file_empty");

  head = new Uint8Array(await chosen.slice(0, HEAD_BYTES).arrayBuffer());
  const tail = new Uint8Array(await chosen.slice(Math.max(0, size - TAIL_BYTES)).arrayBuffer());
  const result = detectFileSettings(head, tail, size);

  if (result.unsupportedEncoding) throw new AppError("unsupported_encoding");
  if (result.empty) throw new AppError("file_empty");
  if (!result.consistent) throw new AppError("csv_parse_error"); // ragged rows

  settings = result.settings;
  columnNames = result.columnNames;
  quoted = detectQuotedColumns(head, size);
  post({
    type: "settingsDetected",
    settings: result.settings,
    confidence: result.confidence,
    columnNames: result.columnNames,
    fileName: chosen.name,
    fileSize: size,
  });
}

async function load(confirmed: FileSettings): Promise<void> {
  if (!file) throw new AppError("file_unreadable");
  const runner = await ensureEngine();
  const size = file.size;

  // The user may have changed the delimiter, quote, header or encoding: re-derive what depends on it.
  const names = columnNamesFor(head, confirmed, size);
  const q = quotingFor(head, confirmed, names.length, size);
  settings = { ...confirmed, quoteStyle: q.quoteStyle, headerQuoted: q.headerQuoted };
  quoted = q.quoted;

  const virtual = `source_${Date.now()}.csv`;
  const mode = readModeFor(settings.encoding);
  let readEncoding: "utf-8" | "utf-16" = "utf-8";

  if (mode.kind === "transcode") {
    const bytes = await transcodeToUtf8(file, settings.encoding, (done, total) =>
      post({ type: "progress", job: "load", done, total }),
    );
    await (engine as Engine).db.registerFileBuffer(virtual, bytes);
  } else {
    readEncoding = mode.encoding;
    await (engine as Engine).db.registerFileHandle(virtual, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
  }

  post({ type: "progress", job: "load", done: 0, total: 1 });
  const loaded = await loadCsv(runner, virtual, settings, names, readEncoding);
  rowCount = loaded.rowCount;
  columnNames = loaded.columnNames;
  post({ type: "progress", job: "load", done: 1, total: 1 });
  post({ type: "loaded", rowCount, columnNames, settings });
}

async function profile(limit: number): Promise<void> {
  const runner = await ensureEngine();
  threshold = limit;
  cancelled = false;
  const profiles: ColumnProfile[] = await profileAll(
    runner,
    columnNames,
    rowCount,
    { threshold, quoted },
    (p) => post({ type: "progress", job: "profile", done: p.done, total: p.total }),
    () => cancelled,
  );
  if (cancelled) throw new AppError("cancelled");
  for (const p of profiles) post({ type: "columnProfile", profile: p });
  post({ type: "profiled", count: profiles.length });
}

async function reprofile(column: string, overrides: Record<string, unknown>): Promise<void> {
  const runner = await ensureEngine();
  const index = columnNames.indexOf(column);
  const p = await profileColumn(runner, column, rowCount, { threshold, quoted }, overrides);
  p.quoted = quoted[index] ?? false;
  post({ type: "columnProfile", profile: p });
}

self.onmessage = async (event: MessageEvent<ProfileRequest>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case "open":
        await open(msg.file);
        break;
      case "load":
        await load(msg.settings);
        break;
      case "profile":
        await profile(msg.threshold);
        break;
      case "reprofile":
        await reprofile(msg.column, msg.overrides);
        break;
      case "datePattern":
        // Counting how many values a typed pattern parses arrives with the date pattern box (US2).
        break;
      case "cancel":
        cancelled = true;
        break;
    }
  } catch (err) {
    // Engine messages quote cell values, so only a sanitized, fixed message is ever posted.
    post({ type: "error", error: toWireError(sanitizeError(err)) });
  }
};
