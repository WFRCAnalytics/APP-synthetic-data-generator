/// <reference lib="webworker" />
// The only place real data lives (constitution Principle I). It owns DuckDB-WASM, reads the file
// the user chose straight from the browser File, and posts back only summaries: settings, column
// names, counts and per-column profiles. Errors go through lib/errors.ts, which never carries a
// cell value. Messages are described in contracts/worker-protocol.md.

import { AppError, sanitizeError, toWireError } from "../lib/errors";
import { NET_CHANNEL } from "../lib/netChannel";
import { installNetPatch } from "./netpatch";
import type { ColumnOverrides, ColumnProfile, FileSettings } from "../lib/profile/types";
import { createEngine, duckdb, loadExcelExtension, loadParquetExtension, type Engine } from "../lib/duckdb/engine";
import { classifyParquet } from "../lib/parquet/detect";
import { inspectParquet, loadParquet, type ParquetInfo } from "./profile/parquet";
import { workbookTooLarge } from "../features/ingest/sizeWarnings";
import { inspectSheet, inspectWorkbook, type SheetHints } from "../lib/xlsx/metadata";
import { parseRange } from "../lib/xlsx/names";
import { loadSheet } from "./profile/xlsx";
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
import { countDatePattern, profileAll, profileColumn } from "./profile/profiler";
import { runnerFor } from "./profile/runner";
import type { SqlRunner } from "./profile/sql";
import { KNOWN_NA_TOKENS } from "../lib/classify/stats";
import { isSupportedPattern } from "../lib/datefmt/directives";
import { readModeFor, transcodeToUtf8 } from "./profile/transcode";

installNetPatch(NET_CHANNEL, self.location.origin);

const BASE = `${import.meta.env.BASE_URL}duckdb/`;
// Where the self-hosted extension files are (public/duckdb-ext/), as an absolute address.
const EXTENSIONS = new URL(`${import.meta.env.BASE_URL}duckdb-ext`, self.location.href).href;

const post = (message: ProfileResponse) => self.postMessage(message);

let engine: Engine | null = null;
let sql: SqlRunner | null = null;
let file: File | null = null;
let head = new Uint8Array(0);
let settings: FileSettings | null = null;
let columnNames: string[] = [];
let quoted: boolean[] = [];
/** The number format code of each column of the loaded sheet (workbooks only). */
let cellFormats: string[] = [];
/** Whether each column of the loaded sheet held text cells (the engine read it as VARCHAR). */
let textCells: boolean[] = [];
/** Columns of the loaded sheet that mix numbers, dates and text (the sheet was read as text). */
let mixedColumns = new Set<string>();
/** Columns (by position) whose cells carry different kinds of number format. */
let mixedFormatColumns = new Set<number>();
let excelLoaded = false;
let parquetLoaded = false;
/** The registered name and structure of the opened Parquet file (null when the file is not Parquet). */
let parquetFile: string | null = null;
let parquetInfo: ParquetInfo | null = null;
let rowCount = 0;
let threshold = 50;
let cancelled = false;
// The latest profile of each column, so a typed date pattern is counted against that column's own
// NA tokens and sentinels.
const latest = new Map<string, ColumnProfile>();
let overridesInUse: Record<string, ColumnOverrides> = {};

async function ensureEngine(): Promise<SqlRunner> {
  if (!engine) {
    engine = await createEngine(BASE);
    const runner = runnerFor(await engine.db.connect());
    // Never fetch an extension from the internet (constitution Principle I); the CSV reader and
    // everything else this app uses are built in.
    await runner.run("SET autoinstall_known_extensions = false");
    await runner.run("SET autoload_known_extensions = false");
    sql = runner;
  }
  return sql as SqlRunner;
}

/** Notes what is known of a column from its file: its Parquet type, and why it cannot be faked if it cannot. */
function markParquet(p: ColumnProfile, index: number): void {
  const column = parquetInfo?.columns[index];
  if (!column) return;
  if (column.type) p.parquetType = column.type;
  if (column.unsupported) {
    p.unsupportedReason = column.unsupported;
    if (!p.attentionReasons.includes("unsupported_type")) p.attentionReasons = [...p.attentionReasons, "unsupported_type"];
  }
}

/** Overrides that make the unsupported columns of a Parquet file stay unsupported, whatever else is asked. */
function withParquetLocks(overrides: Record<string, ColumnOverrides>): Record<string, ColumnOverrides> {
  if (!parquetInfo) return overrides;
  const out = { ...overrides };
  for (const c of parquetInfo.columns) if (c.unsupported) out[c.name] = { ...out[c.name], type: "unsupported" };
  return out;
}

/** Notes how the real cells of a workbook column were stored: its number format, and whether they held text. */
function markCells(p: ColumnProfile, index: number): void {
  markParquet(p, index);
  const format = cellFormats[index];
  if (format && !/^general$/i.test(format)) p.cellFormat = format;
  // Text cells that read as numbers or dates are written back as text cells, not numbers.
  const reads = p.type === "integer" || p.type === "float" || p.type === "date" || p.type === "datetime" || p.type === "time" || (p.type === "categorical" && p.summary.kind === "categorical" && p.summary.storage === "integer");
  if (textCells[index] && reads) p.storedAsText = true;
  // Reasons that belong to one column. Merged cells and a hidden sheet are about the whole sheet, so the
  // load dialog says them once instead of every card.
  const reasons: ColumnProfile["attentionReasons"] = [];
  if (mixedColumns.has(p.name)) reasons.push("mixed_cells");
  if (mixedFormatColumns.has(index)) reasons.push("format_mismatch");
  for (const reason of reasons) {
    if (p.attentionReasons.includes(reason)) continue;
    p.attentionReasons = [...p.attentionReasons, reason];
    if (p.status === "ok") p.status = "needs_attention";
  }
}

/** Whether the file is a workbook by its content (a zip, or the old OLE container), whatever it is called. */
async function looksLikeWorkbook(chosen: File): Promise<boolean> {
  const first = new Uint8Array(await chosen.slice(0, 8).arrayBuffer());
  const zip = first[0] === 0x50 && first[1] === 0x4b;
  const ole = first.length >= 8 && first[0] === 0xd0 && first[1] === 0xcf && first[2] === 0x11 && first[3] === 0xe0;
  return zip || ole;
}

async function open(chosen: File): Promise<void> {
  file = chosen;
  const size = chosen.size;
  if (size === 0) throw new AppError("file_empty");

  // A Parquet file is told by its first and last bytes, not its name (specs/005 FR-001, FR-015).
  parquetFile = null;
  parquetInfo = null;
  const first = new Uint8Array(await chosen.slice(0, 8).arrayBuffer());
  const last = new Uint8Array(await chosen.slice(Math.max(0, size - 8)).arrayBuffer());
  const kind = classifyParquet(first, last);
  if (kind === "encrypted") throw new AppError("parquet_encrypted");
  if (kind === "damaged") throw new AppError("parquet_damaged");
  if (kind === "parquet") {
    await openParquet(chosen);
    return;
  }
  if (/\.parquet$/i.test(chosen.name)) throw new AppError("parquet_not_parquet");

  if (await looksLikeWorkbook(chosen)) {
    const info = await inspectWorkbook(chosen); // refuses damaged, old, encrypted and non-workbook files
    post({ type: "workbookInfo", info, fileName: chosen.name, fileSize: size });
    return;
  }

  head = new Uint8Array(await chosen.slice(0, HEAD_BYTES).arrayBuffer());
  const tail = new Uint8Array(await chosen.slice(Math.max(0, size - TAIL_BYTES)).arrayBuffer());
  const result = detectFileSettings(head, tail, size);

  if (result.unsupportedEncoding) throw new AppError("unsupported_encoding");
  if (result.empty) throw new AppError("file_empty");
  if (!result.consistent) throw new AppError("csv_parse_error"); // ragged rows

  settings = result.settings;
  columnNames = result.columnNames;
  cellFormats = [];
  textCells = [];
  mixedColumns = new Set();
  mixedFormatColumns = new Set();
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

/** Reads the structure of a Parquet file and tells the page; no value is read (specs/005 research R2). */
async function openParquet(chosen: File): Promise<void> {
  const runner = await ensureEngine();
  if (!parquetLoaded) {
    await loadParquetExtension((q) => runner.run(q), EXTENSIONS);
    parquetLoaded = true;
  }
  const virtual = `source_${Date.now()}.parquet`;
  await (engine as Engine).db.registerFileHandle(virtual, chosen, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
  const info = await inspectParquet(runner, virtual);
  parquetFile = virtual;
  parquetInfo = info;
  settings = null;
  cellFormats = [];
  textCells = [];
  mixedColumns = new Set();
  mixedFormatColumns = new Set();
  post({
    type: "parquetInfo",
    fileName: chosen.name,
    fileSize: chosen.size,
    info: { rowCount: info.rowCount, rowGroups: info.rowGroups, expandedBytes: info.expandedBytes, columns: info.columns.map((c) => ({ name: c.name, type: c.type, unsupported: c.unsupported, renamed: c.renamed })) },
  });
}

/** Loads the opened Parquet file into the all-text table. */
async function loadParquetFile(): Promise<void> {
  if (!parquetFile || !parquetInfo) throw new AppError("file_unreadable");
  const runner = await ensureEngine();
  post({ type: "progress", job: "load", done: 0, total: 1 });
  const loaded = await loadParquet(runner, parquetFile, parquetInfo);
  rowCount = loaded.rowCount;
  columnNames = loaded.columnNames;
  quoted = loaded.columnNames.map(() => false);
  post({ type: "progress", job: "load", done: 1, total: 1 });
  post({ type: "loaded", rowCount, columnNames, settings: { parquet: true, rowGroups: parquetInfo.rowGroups } });
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

/** Hints for the dialog: rows to skip, the table's width, formats, merged cells. */
async function sheetHints(sheet: string): Promise<void> {
  if (!file) throw new AppError("file_unreadable");
  const hints: SheetHints = await inspectSheet(file, sheet);
  post({ type: "sheetHints", sheet, hints });
}

/** Loads the chosen sheet into the all-text table, with the settings the user confirmed. */
async function loadWorkbookSheet(m: { sheet: string; range?: string; skipRows: number; header: boolean; date1904: boolean }): Promise<void> {
  if (!file) throw new AppError("file_unreadable");
  const runner = await ensureEngine();
  if (!excelLoaded) {
    await loadExcelExtension((q) => runner.run(q), EXTENSIONS);
    excelLoaded = true;
  }
  const range = m.range ? parseRange(m.range) : null;
  if (m.range && !range) throw new AppError("xlsx_range_invalid");
  const chosenSheet = (await inspectWorkbook(file)).sheets.find((s) => s.name === m.sheet);
  if (!chosenSheet) throw new AppError("xlsx_sheet_missing");
  if (workbookTooLarge(chosenSheet.expandedBytes)) throw new AppError("xlsx_too_large");

  // The format code of each column, from the cell styles of the first data cells (never a value). Read
  // first, because a sheet that has to be read as text needs the formats to turn date serials into dates.
  const hints = await inspectSheet(file, m.sheet, { skipRows: m.skipRows, firstCol: range?.firstCol, lastCol: range?.lastCol });

  const virtual = `book_${Date.now()}.xlsx`;
  await (engine as Engine).db.registerFileHandle(virtual, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
  post({ type: "progress", job: "load", done: 0, total: 1 });
  const loaded = await loadSheet(runner, virtual, { sheet: m.sheet, range: m.range, header: m.header, formats: hints.formats, date1904: m.date1904 });
  rowCount = loaded.rowCount;
  columnNames = loaded.columnNames;
  quoted = loaded.columnNames.map(() => false);

  cellFormats = loaded.columnNames.map((_, i) => hints.formats[i] ?? "General");
  mixedColumns = new Set(loaded.mixedColumns ?? []);
  mixedFormatColumns = new Set(hints.mixedFormats);
  // A column the engine read as text, or that mixes kinds, held text cells.
  textCells = (loaded.columnTypes ?? []).map((t, i) => t === "VARCHAR" || mixedColumns.has(loaded.columnNames[i]));
  settings = null;
  post({ type: "progress", job: "load", done: 1, total: 1 });
  post({ type: "loaded", rowCount, columnNames, settings: { sheet: m.sheet, ...(m.range ? { range: m.range } : {}), skipRows: m.skipRows, header: m.header, date1904: m.date1904 } });
}

async function profile(limit: number, overrides: Record<string, ColumnOverrides> = {}): Promise<void> {
  const runner = await ensureEngine();
  threshold = limit;
  cancelled = false;
  overridesInUse = withParquetLocks(overrides);
  const profiles: ColumnProfile[] = await profileAll(
    runner,
    columnNames,
    rowCount,
    { threshold, quoted },
    (p) => post({ type: "progress", job: "profile", done: p.done, total: p.total }),
    () => cancelled,
    overridesInUse,
  );
  if (cancelled) throw new AppError("cancelled");
  latest.clear();
  for (const [i, p] of profiles.entries()) {
    markCells(p, i);
    latest.set(p.name, p);
    post({ type: "columnProfile", profile: p });
  }
  post({ type: "profiled", count: profiles.length });
}

async function reprofile(column: string, overrides: ColumnOverrides): Promise<void> {
  const runner = await ensureEngine();
  const index = columnNames.indexOf(column);
  overridesInUse = withParquetLocks({ ...overridesInUse, [column]: overrides });
  const p = await profileColumn(runner, column, rowCount, { threshold, quoted }, overridesInUse[column]);
  p.quoted = quoted[index] ?? false;
  markCells(p, index);
  latest.set(column, p);
  post({ type: "columnProfile", profile: p });
}

/** Counts how many values a typed date pattern parses, so the user sees it before applying it. */
async function datePattern(column: string, pattern: string): Promise<void> {
  if (!isSupportedPattern(pattern)) {
    post({ type: "datePatternResult", column, parsed: 0, total: 0 });
    return;
  }
  const runner = await ensureEngine();
  const current = latest.get(column);
  const naTokens = overridesInUse[column]?.naTokens ?? [...KNOWN_NA_TOKENS];
  const { parsed, total } = await countDatePattern(runner, column, pattern, naTokens, Object.keys(current?.sentinels ?? {}));
  post({ type: "datePatternResult", column, parsed, total });
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
      case "inspectSheet":
        await sheetHints(msg.sheet);
        break;
      case "loadSheet":
        await loadWorkbookSheet(msg);
        break;
      case "loadParquet":
        await loadParquetFile();
        break;
      case "profile":
        await profile(msg.threshold, msg.overrides);
        break;
      case "reprofile":
        await reprofile(msg.column, msg.overrides);
        break;
      case "datePattern":
        await datePattern(msg.column, msg.pattern);
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
