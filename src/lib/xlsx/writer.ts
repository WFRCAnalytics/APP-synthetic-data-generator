// Writing the fake workbook (specs/003 FR-006, FR-008, FR-011, research R7). One sheet, with the real
// sheet's name, its empty rows above the header, its column order, and cells of the right type and
// number format: numbers as numbers, dates as serial numbers in the workbook's date system, text as
// text (leading zeros kept), blank cells left out and empty text written as an empty string cell.
//
// The package is written as a stream: rows become sheet XML in chunks, each part is deflated as it
// goes, and the zip is emitted with data descriptors, so a sheet of hundreds of megabytes never has to
// sit in memory. Strings are written inline (no shared string table), which is what lets rows stream.

import { EMPTY_TEXT_TOKEN, type ColumnSpec } from "../spec/types";
import { cellRef, columnLetters } from "./names";
import { isoToSerial } from "./serial";
import { createZipWriter } from "./zip";

export type CellKind = "number" | "text" | "date" | "datetime" | "time" | "boolean";

export interface XlsxColumnLayout {
  name: string;
  kind: CellKind;
  /** The column's number format code (`@` for text). Absent means General. */
  format?: string;
}

export interface XlsxLayout {
  sheet: string;
  /** Empty rows above the header. */
  skipRows: number;
  header: boolean;
  date1904: boolean;
  columns: XlsxColumnLayout[];
  nRows: number;
}

/** The kind of cell a generated column is written as. */
export function cellKindOf(col: ColumnSpec): CellKind {
  switch (col.type) {
    case "integer":
    case "float":
      return "number";
    case "date":
    case "datetime":
    case "time":
      return col.type;
    case "boolean":
      return "boolean";
    case "categorical":
      return col.storage === "integer" ? "number" : "text";
    case "survey_id":
      // A whole-number ID with no padding is a number; anything else (a pattern, leading zeros) is text.
      return col.mask.length > 0 && col.mask.every((t) => t === "digit") && !col.pad_width ? "number" : "text";
    default:
      return "text";
  }
}

// ---- XML ---------------------------------------------------------------------------------------

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

/** Removes characters XML 1.0 cannot hold (control characters other than tab, line feed and carriage return). */
const clean = (s: string) => Array.from(s).filter((ch) => {
  const c = ch.charCodeAt(0);
  return c >= 32 || c === 9 || c === 10 || c === 13;
}).join("");

function inlineString(text: string): string {
  const t = clean(text);
  const preserve = /^\s|\s$|[\n\t\r]/.test(t) ? ' xml:space="preserve"' : "";
  return `<is><t${preserve}>${escapeText(t)}</t></is>`;
}

// ---- Styles ------------------------------------------------------------------------------------

interface StyleTable {
  /** Style index (1-based) of a format code; 0 means the default style. */
  indexOf(code: string | undefined): number;
  xml(): string;
}

function buildStyles(columns: readonly XlsxColumnLayout[]): StyleTable {
  const codes: string[] = [];
  for (const c of columns) {
    const code = c.format;
    if (code && !/^general$/i.test(code) && !codes.includes(code)) codes.push(code);
  }
  const custom = codes.filter((c) => c !== "@");
  const idOf = (code: string) => (code === "@" ? 49 : 164 + custom.indexOf(code));

  const numFmts = custom.length > 0 ? `<numFmts count="${custom.length}">${custom.map((c, i) => `<numFmt numFmtId="${164 + i}" formatCode="${escapeAttr(c)}"/>`).join("")}</numFmts>` : "";
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', ...codes.map((c) => `<xf numFmtId="${idOf(c)}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`)].join("");
  const xml =
    `${XML_DECL}<styleSheet xmlns="${NS_MAIN}">${numFmts}` +
    `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${codes.length + 1}">${xfs}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return { indexOf: (code) => (code && codes.includes(code) ? codes.indexOf(code) + 1 : 0), xml: () => xml };
}

// ---- Cells -------------------------------------------------------------------------------------

const NUMBER = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** The XML of one cell, or an empty string for a blank cell. */
function cellXml(ref: string, text: string, kind: CellKind, style: number, date1904: boolean): string {
  if (text === "") return ""; // a blank cell has no cell
  const s = style > 0 ? ` s="${style}"` : "";
  if (text === EMPTY_TEXT_TOKEN) return `<c r="${ref}"${s} t="inlineStr"><is><t></t></is></c>`;
  const asText = () => `<c r="${ref}"${style > 0 && kind === "text" ? s : ""} t="inlineStr">${inlineString(text)}</c>`;

  switch (kind) {
    case "number": {
      const n = text.replace(/,/g, "");
      return NUMBER.test(n) && Number.isFinite(Number(n)) ? `<c r="${ref}"${s}><v>${Number(n)}</v></c>` : asText();
    }
    case "date":
    case "datetime":
    case "time": {
      const serial = isoToSerial(text, date1904);
      return serial === null ? asText() : `<c r="${ref}"${s}><v>${serial}</v></c>`;
    }
    case "boolean": {
      const t = text.toUpperCase();
      return t === "TRUE" || t === "FALSE" ? `<c r="${ref}" t="b"><v>${t === "TRUE" ? 1 : 0}</v></c>` : asText();
    }
    default:
      return `<c r="${ref}"${s} t="inlineStr">${inlineString(text)}</c>`;
  }
}

// ---- The package -------------------------------------------------------------------------------

const enc = new TextEncoder();
const FLUSH_CHARS = 64 * 1024;

async function* sheetChunks(layout: XlsxLayout, styles: StyleTable, rows: Iterable<string[]> | AsyncIterable<string[]>): AsyncGenerator<Uint8Array> {
  const { columns, skipRows } = layout;
  const firstRow = skipRows + 1; // one-based row of the header, or of the first data row
  const lastRow = Math.max(firstRow, skipRows + (layout.header ? 1 : 0) + layout.nRows);
  const lastCol = Math.max(0, columns.length - 1);
  const styleOf = columns.map((c) => styles.indexOf(c.format));

  let buffer = `${XML_DECL}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><dimension ref="${cellRef(0, firstRow - 1)}:${cellRef(lastCol, lastRow - 1)}"/><sheetData>`;
  let rowNumber = skipRows;

  const rowXml = (r: number, cells: string): string => (cells === "" ? "" : `<row r="${r}">${cells}</row>`);

  if (layout.header) {
    rowNumber++;
    let cells = "";
    columns.forEach((c, i) => (cells += `<c r="${cellRef(i, rowNumber - 1)}" t="inlineStr">${inlineString(c.name)}</c>`));
    buffer += rowXml(rowNumber, cells);
  }

  for await (const values of rows as AsyncIterable<string[]>) {
    rowNumber++;
    let cells = "";
    for (let i = 0; i < columns.length; i++) cells += cellXml(`${columnLetters(i)}${rowNumber}`, values[i] ?? "", columns[i].kind, styleOf[i], layout.date1904);
    buffer += rowXml(rowNumber, cells);
    if (buffer.length >= FLUSH_CHARS) {
      yield enc.encode(buffer);
      buffer = "";
    }
  }
  yield enc.encode(`${buffer}</sheetData></worksheet>`);
}

function* parts(layout: XlsxLayout, styles: StyleTable): Generator<{ name: string; text: string }> {
  yield {
    name: "[Content_Types].xml",
    text:
      `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  };
  yield { name: "_rels/.rels", text: `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` };
  yield {
    name: "xl/workbook.xml",
    text:
      `${XML_DECL}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">${layout.date1904 ? '<workbookPr date1904="1"/>' : ""}` +
      `<sheets><sheet name="${escapeAttr(layout.sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  };
  yield {
    name: "xl/_rels/workbook.xml.rels",
    text: `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`,
  };
  yield { name: "xl/styles.xml", text: styles.xml() };
}

/** The bytes of the workbook as they are produced: zip chunks for the sheet's rows, which are text values per column. */
export async function* workbookChunks(layout: XlsxLayout, rows: Iterable<string[]> | AsyncIterable<string[]>): AsyncGenerator<Uint8Array> {
  const styles = buildStyles(layout.columns);
  const queue: Uint8Array[] = [];
  const signal: { wake: (() => void) | null } = { wake: null };
  let finished = false;
  let failure: unknown;

  const zip = createZipWriter((chunk) => {
    queue.push(chunk);
    signal.wake?.();
  });

  // The producer writes while this generator hands chunks to the caller, so memory stays bounded by what the caller has not yet taken.
  const producer = (async () => {
    try {
      for (const part of parts(layout, styles)) {
        if (part.name === "xl/worksheets/sheet1.xml") break;
        await zip.addEntry(part.name, [enc.encode(part.text)]);
      }
      await zip.addEntry("xl/worksheets/sheet1.xml", sheetChunks(layout, styles, rows));
      await zip.finish();
    } catch (e) {
      failure = e;
    } finally {
      finished = true;
      signal.wake?.();
    }
  })();

  for (;;) {
    if (queue.length > 0) {
      yield queue.shift() as Uint8Array;
      continue;
    }
    if (finished) break;
    await new Promise<void>((resolve) => {
      signal.wake = resolve;
    });
    signal.wake = null;
  }
  await producer;
  if (failure) throw failure;
}

/** The whole workbook in memory, for tests and small tables. */
export async function workbookBytes(layout: XlsxLayout, rows: Iterable<string[]> | AsyncIterable<string[]>): Promise<Uint8Array> {
  const out: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of workbookChunks(layout, rows)) {
    out.push(chunk);
    length += chunk.length;
  }
  const all = new Uint8Array(length);
  let at = 0;
  for (const c of out) {
    all.set(c, at);
    at += c.length;
  }
  return all;
}
