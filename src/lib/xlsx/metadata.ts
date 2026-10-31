// Reading a workbook's own packaging (specs/003 research R1, R5, R9, R10, R11): which sheets it has,
// whether the 1904 date system is on, the number format code of each column, and hints for the load
// dialog (rows to skip, the table's width, merged cells). It looks only at the workbook, its
// relationships, the styles and, for hints, the head of the one sheet asked about. It never reads the
// shared strings (where the real text lives), other sheets, comments or drawings, and it returns
// names, flags, sizes and format codes, never a cell value.

import { builtInFormat, describeFormat } from "./formats";
import { columnIndex } from "./names";
import { ZipError, readEntryHead, readEntryText, readZipDirectory, openEntry, type ZipEntry } from "./zip";

import { describeError } from "../errors";

export type XlsxErrorCode = "xlsx_damaged" | "xlsx_legacy" | "xlsx_encrypted" | "xlsx_not_workbook" | "xlsx_sheet_missing" | "xlsx_range_invalid" | "xlsx_too_large";

/** A problem with a workbook. The message is fixed text and never holds file content. */
export class XlsxError extends Error {
  constructor(
    readonly code: XlsxErrorCode,
    message?: string,
  ) {
    super(message ?? describeError(code));
    this.name = "XlsxError";
  }
}

export interface InspectOptions {
  /** Called with the name of every package part that is opened (tests use it to prove what is read). */
  trace?: (part: string) => void;
  /** Merged cells are looked for only in sheets up to this many expanded bytes (default 300 MB). */
  mergeCheckLimit?: number;
  /** How much of the head of a sheet to read for hints (default 3 MB expanded). */
  headBytes?: number;
}

export interface SheetInfo {
  name: string;
  hidden: boolean;
  veryHidden: boolean;
  /** Expanded size of the sheet's data, from the zip directory. */
  expandedBytes: number;
}

export interface WorkbookInfo {
  sheets: SheetInfo[];
  date1904: boolean;
  /** The first visible sheet. */
  defaultSheet: string;
}

export interface SheetHints {
  suggestedSkipRows: number;
  /** Zero-based columns of the table: the unbroken run of cells in the header row. */
  firstCol: number;
  lastCol: number;
  /** Zero-based last row of the sheet's used range. */
  lastRow: number;
  /** One format code per column of the table ("General" when the cells carry none). */
  formats: string[];
  /** Zero-based positions (within the table) of columns whose cells carry different kinds of format. */
  mixedFormats: number[];
  mergedCells: boolean | "not_checked";
  expandedBytes: number;
}

// ---- Small XML helpers (the parts read here are tiny and regular) ---------------------------------

const decodeXml = (s: string): string =>
  s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : undefined;
}

const tags = (xml: string, name: string): string[] => xml.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];

// ---- Opening a workbook ------------------------------------------------------------------------

interface Package {
  blob: Blob;
  entries: Map<string, ZipEntry>;
  trace?: (part: string) => void;
}

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

async function checkKind(blob: Blob): Promise<void> {
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b) return; // a zip
  if (head.length >= 8 && OLE.every((b, i) => head[i] === b)) {
    // An old binary workbook, or a password-protected modern one (which is stored the same way, with an EncryptedPackage stream).
    const scan = new Uint8Array(await blob.slice(0, 2 * 1024 * 1024).arrayBuffer());
    const needle = new TextEncoder().encode("E\0n\0c\0r\0y\0p\0t\0e\0d\0P\0a\0c\0k\0a\0g\0e\0");
    outer: for (let i = 0; i + needle.length <= scan.length; i++) {
      for (let j = 0; j < needle.length; j++) if (scan[i + j] !== needle[j]) continue outer;
      throw new XlsxError("xlsx_encrypted");
    }
    throw new XlsxError("xlsx_legacy");
  }
  throw new XlsxError("xlsx_not_workbook");
}

async function openPackage(blob: Blob, options: InspectOptions): Promise<Package> {
  await checkKind(blob);
  let list: ZipEntry[];
  try {
    list = await readZipDirectory(blob);
  } catch (e) {
    if (e instanceof ZipError) throw new XlsxError(e.code === "unsupported" ? "xlsx_too_large" : e.code === "not_zip" ? "xlsx_not_workbook" : "xlsx_damaged");
    throw e;
  }
  const entries = new Map(list.map((e) => [e.name, e]));
  if (!entries.has("xl/workbook.xml")) throw new XlsxError("xlsx_not_workbook");
  return { blob, entries, trace: options.trace };
}

async function readPart(pkg: Package, name: string): Promise<string | null> {
  const entry = pkg.entries.get(name);
  if (!entry) return null;
  pkg.trace?.(name);
  try {
    return await readEntryText(pkg.blob, entry);
  } catch (e) {
    if (e instanceof ZipError) throw new XlsxError("xlsx_damaged");
    throw e;
  }
}

interface SheetRef {
  name: string;
  hidden: boolean;
  veryHidden: boolean;
  part: string;
}

async function readWorkbookParts(pkg: Package): Promise<{ sheets: SheetRef[]; date1904: boolean }> {
  const workbook = (await readPart(pkg, "xl/workbook.xml")) as string;
  const rels = (await readPart(pkg, "xl/_rels/workbook.xml.rels")) ?? "";

  const targets = new Map<string, string>();
  for (const rel of tags(rels, "Relationship")) {
    const id = attr(rel, "Id");
    const target = attr(rel, "Target");
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }

  const sheets: SheetRef[] = [];
  for (const tag of tags(workbook, "sheet")) {
    const name = attr(tag, "name");
    const id = attr(tag, "r:id") ?? attr(tag, "id");
    const state = attr(tag, "state");
    const part = id ? targets.get(id) : undefined;
    if (name !== undefined && part) sheets.push({ name, hidden: state === "hidden" || state === "veryHidden", veryHidden: state === "veryHidden", part });
  }
  if (sheets.length === 0) throw new XlsxError("xlsx_not_workbook");

  const pr = tags(workbook, "workbookPr")[0] ?? "";
  const d = attr(pr, "date1904");
  return { sheets, date1904: d === "1" || d === "true" };
}

/** Sheet names, visibility, sizes and the date system. No cell value is read. */
export async function inspectWorkbook(blob: Blob, options: InspectOptions = {}): Promise<WorkbookInfo> {
  const pkg = await openPackage(blob, options);
  const { sheets, date1904 } = await readWorkbookParts(pkg);
  const info: SheetInfo[] = sheets.map((s) => ({ name: s.name, hidden: s.hidden, veryHidden: s.veryHidden, expandedBytes: pkg.entries.get(s.part)?.uncompressedSize ?? 0 }));
  return { sheets: info, date1904, defaultSheet: (info.find((s) => !s.hidden) ?? info[0]).name };
}

// ---- Styles ------------------------------------------------------------------------------------

/** The format code of each cell style (the `s` attribute of a cell), in order. */
async function readStyleFormats(pkg: Package): Promise<string[]> {
  const xml = await readPart(pkg, "xl/styles.xml");
  if (!xml) return [];
  const custom = new Map<number, string>();
  for (const tag of tags(xml, "numFmt")) {
    const id = attr(tag, "numFmtId");
    const code = attr(tag, "formatCode");
    if (id !== undefined && code !== undefined) custom.set(Number(id), code);
  }
  const block = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  if (!block) return [];
  return tags(block[1], "xf").map((tag) => {
    const id = Number(attr(tag, "numFmtId") ?? 0);
    return custom.get(id) ?? builtInFormat(id) ?? "General";
  });
}

// ---- The head of a sheet -----------------------------------------------------------------------

interface HeadRow {
  r: number; // one-based
  cells: { col: number; style: number; populated: boolean }[];
}

function parseHead(text: string): { rows: HeadRow[]; lastRow: number | null } {
  const cut = text.lastIndexOf("</row>");
  const body = cut >= 0 ? text.slice(0, cut + 6) : text;
  const dim = /<dimension\b[^>]*\bref="([^"]*)"/.exec(text);
  let lastRow: number | null = null;
  if (dim) {
    const m = /(\d+)$/.exec(dim[1]);
    if (m) lastRow = Number(m[1]) - 1;
  }

  const rows: HeadRow[] = [];
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(body))) {
    const r = Number(attr(rm[1], "r"));
    if (!Number.isFinite(r)) continue;
    const cells: HeadRow["cells"] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[2] ?? ""))) {
      const ref = attr(cm[1], "r") ?? "";
      const letters = /^[A-Za-z]+/.exec(ref);
      if (!letters) continue;
      let col: number;
      try {
        col = columnIndex(letters[0]);
      } catch {
        continue;
      }
      const inner = cm[2] ?? "";
      // Only whether the cell holds something is kept; what it holds is never copied out.
      const populated = /<v>[^<]/.test(inner) || /<is>/.test(inner);
      cells.push({ col, style: Number(attr(cm[1], "s") ?? 0), populated });
    }
    rows.push({ r, cells });
  }
  return { rows, lastRow };
}

/** The first row whose width reaches half of the widest of the first 50 rows is taken as the header. */
function findHeader(rows: HeadRow[]): HeadRow | null {
  const populated = (row: HeadRow) => row.cells.filter((c) => c.populated).length;
  const early = rows.filter((r) => populated(r) > 0).slice(0, 50);
  if (early.length === 0) return null;
  const widest = Math.max(...early.map(populated));
  const threshold = Math.max(1, Math.ceil(widest / 2));
  return early.find((r) => populated(r) >= threshold) ?? early[0];
}

const kindClass = (code: string): "temporal" | "text" | "numeric" => {
  const kind = describeFormat(code).kind;
  return kind === "date" || kind === "time" || kind === "datetime" ? "temporal" : kind === "text" ? "text" : "numeric";
};

async function hasMergedCells(blob: Blob, entry: ZipEntry): Promise<boolean> {
  const reader = (await openEntry(blob, entry)).getReader();
  const decoder = new TextDecoder("utf-8");
  let carry = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return false;
      const text = carry + decoder.decode(value, { stream: true });
      if (text.includes("<mergeCell ") || text.includes("<mergeCells")) return true;
      carry = text.slice(-16);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** Hints for the load dialog from the head of one sheet. */
export async function inspectSheet(blob: Blob, sheetName: string, options: InspectOptions = {}): Promise<SheetHints> {
  const pkg = await openPackage(blob, options);
  const { sheets } = await readWorkbookParts(pkg);
  const sheet = sheets.find((s) => s.name === sheetName);
  if (!sheet) throw new XlsxError("xlsx_sheet_missing");
  const entry = pkg.entries.get(sheet.part);
  if (!entry) throw new XlsxError("xlsx_damaged");

  const styleFormats = await readStyleFormats(pkg);
  pkg.trace?.(sheet.part);
  let head: Uint8Array;
  try {
    head = await readEntryHead(blob, entry, options.headBytes ?? 3 * 1024 * 1024);
  } catch (e) {
    if (e instanceof ZipError) throw new XlsxError("xlsx_damaged");
    throw e;
  }
  const { rows, lastRow } = parseHead(new TextDecoder("utf-8").decode(head));
  const header = findHeader(rows);

  let firstCol = 0;
  let lastCol = 0;
  let suggestedSkipRows = 0;
  const formats: string[] = [];
  const mixedFormats: number[] = [];

  if (header) {
    suggestedSkipRows = header.r - 1;
    const cols = header.cells.filter((c) => c.populated).map((c) => c.col).sort((a, b) => a - b);
    firstCol = cols[0];
    lastCol = firstCol;
    for (const c of cols) {
      if (c === lastCol + 1) lastCol = c;
      else if (c > lastCol + 1) break;
    }

    const data = rows.filter((r) => r.r > header.r).slice(0, 20);
    for (let col = firstCol; col <= lastCol; col++) {
      const codes: string[] = [];
      for (const row of data) {
        const cell = row.cells.find((c) => c.col === col && c.populated);
        if (cell) codes.push(styleFormats[cell.style] ?? "General");
      }
      formats.push(codes[0] ?? "General");
      if (new Set(codes.map(kindClass)).size > 1) mixedFormats.push(col - firstCol);
    }
  }

  const limit = options.mergeCheckLimit ?? 300 * 1024 * 1024;
  const mergedCells = entry.uncompressedSize <= limit ? await hasMergedCells(blob, entry) : "not_checked";

  return {
    suggestedSkipRows,
    firstCol,
    lastCol,
    lastRow: lastRow ?? Math.max(0, ...rows.map((r) => r.r - 1)),
    formats,
    mixedFormats,
    mergedCells,
    expandedBytes: entry.uncompressedSize,
  };
}
