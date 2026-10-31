// Detects a CSV file's dialect from a decoded sample (FR-002): delimiter, quote style (including
// per-column quoting), header presence, line endings, column names. Done in TypeScript, not by
// DuckDB's sniffer, so the same settings drive both loading and the export (research.md R3), and
// so a malformed file fails loudly instead of being misread.

import type { Encoding } from "../encoding/detect";
import type { LineEnding, QuoteStyle } from "./writer";

export interface SniffResult {
  delimiter: string;
  quote: string | null;
  header: boolean;
  headerQuoted: boolean;
  lineEnding: LineEnding;
  quoteStyle: QuoteStyle;
  /** Per column: were the non-empty fields written in quotes (used by per_column quoting). */
  quoted: boolean[];
  columnCount: number;
  /** Unique, non-blank names (from the header, or column_1, column_2, ...). */
  columnNames: string[];
  /** True when every sampled record has the same number of fields. */
  consistent: boolean;
  recordsSampled: number;
}

const CANDIDATES = [",", ";", "\t", "|"];
const MAX_RECORDS = 10_000;

interface Parsed {
  rows: string[][];
  quoted: boolean[][];
}

/** Quote-aware record splitter over a text sample. Drops an incomplete final record. */
export function splitRecords(text: string, delimiter: string, quote: string | null, truncated: boolean, maxRecords = MAX_RECORDS): Parsed {
  const rows: string[][] = [];
  const quoted: boolean[][] = [];
  let row: string[] = [];
  let flags: boolean[] = [];
  let field = "";
  let wasQuoted = false;
  let inQuotes = false;
  let pending = false; // something has been read for the current record

  const endField = () => {
    row.push(field);
    flags.push(wasQuoted);
    field = "";
    wasQuoted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    quoted.push(flags);
    row = [];
    flags = [];
    pending = false;
  };

  for (let i = 0; i < text.length && rows.length < maxRecords; i++) {
    const ch = text[i];
    pending = true;
    if (inQuotes) {
      if (ch === quote) {
        if (text[i + 1] === quote) {
          field += quote;
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (quote !== null && ch === quote && field === "") {
      inQuotes = true;
      wasQuoted = true;
    } else if (ch === delimiter) endField();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") endRow();
    else field += ch;
  }
  // A final record without a line ending is real data in a complete file, but unreliable when the
  // sample was cut off in the middle of it.
  if (pending && !truncated && rows.length < maxRecords && !inQuotes) endRow();
  return { rows, quoted };
}

function modalCount(rows: string[][]): { count: number; share: number } {
  const tally = new Map<number, number>();
  for (const r of rows) tally.set(r.length, (tally.get(r.length) ?? 0) + 1);
  let best = 0;
  let bestN = 0;
  for (const [len, n] of tally) {
    if (n > bestN || (n === bestN && len > best)) {
      best = len;
      bestN = n;
    }
  }
  return { count: best, share: rows.length ? bestN / rows.length : 1 };
}

function pickDelimiter(text: string, quote: string | null, truncated: boolean): string {
  let best = ",";
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const { rows } = splitRecords(text, d, quote, truncated, 200);
    if (rows.length === 0) continue;
    const { count, share } = modalCount(rows);
    if (count < 2) continue;
    const score = share * 1000 + count; // consistency first, then more columns
    if (share >= 0.9 && score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function detectLineEnding(text: string): LineEnding {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length && i < 200_000; i++) {
    if (text[i] === "\r") {
      if (text[i + 1] === "\n") {
        crlf++;
        i++;
      } else cr++;
    } else if (text[i] === "\n") lf++;
  }
  if (crlf >= lf && crlf >= cr && crlf > 0) return "crlf";
  if (cr > lf && cr > crlf) return "cr";
  return "lf";
}

const NUMERIC = /^[+-]?(\d+([.,]\d+)?|\.\d+)$/;

function looksLikeHeader(first: string[], rest: string[][]): boolean {
  // Blank names are allowed (they are renamed later); numbers in the first row mean it is data.
  const filled = first.filter((c) => c.trim() !== "");
  if (filled.length === 0) return false;
  if (filled.some((c) => NUMERIC.test(c.trim()))) return false;
  if (rest.length === 0) return true;
  // A numeric column below the first row makes a text first row almost certainly a header.
  for (let c = 0; c < first.length; c++) {
    const values = rest.slice(0, 200).map((r) => r[c]).filter((v) => v !== undefined && v.trim() !== "");
    if (values.length > 0 && values.filter((v) => NUMERIC.test(v.trim())).length / values.length > 0.9) return true;
  }
  return new Set(filled).size === filled.length;
}

/** Makes names unique and non-blank, the way DuckDB does: a, a_1; blank becomes column_N. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((raw, i) => {
    let name = raw.trim() === "" ? `column_${i + 1}` : raw;
    if (seen.has(name)) {
      let n = 1;
      while (seen.has(`${name}_${n}`)) n++;
      name = `${name}_${n}`;
    }
    seen.add(name);
    return name;
  });
}

function needsQuoting(value: string, delimiter: string, quote: string | null): boolean {
  return (
    value.includes(delimiter) ||
    (quote !== null && value.includes(quote)) ||
    value.includes("\n") ||
    value.includes("\r") ||
    /^[ \t]|[ \t]$/.test(value)
  );
}

function inferQuoting(
  rows: string[][],
  flags: boolean[][],
  columnCount: number,
  delimiter: string,
  quote: string | null,
): { quoteStyle: QuoteStyle; quoted: boolean[] } {
  const nonEmpty = new Array<number>(columnCount).fill(0);
  const quotedN = new Array<number>(columnCount).fill(0);
  const needed = new Array<number>(columnCount).fill(0);
  rows.forEach((row, r) => {
    for (let c = 0; c < Math.min(row.length, columnCount); c++) {
      if (row[c] === "") continue;
      nonEmpty[c]++;
      if (flags[r][c]) quotedN[c]++;
      if (needsQuoting(row[c], delimiter, quote)) needed[c]++;
    }
  });

  const used = nonEmpty.map((n, c) => (n > 0 ? c : -1)).filter((c) => c >= 0);
  if (used.length === 0 || quote === null) return { quoteStyle: "minimal", quoted: new Array(columnCount).fill(false) };

  if (used.every((c) => quotedN[c] / nonEmpty[c] >= 0.99)) {
    return { quoteStyle: "all", quoted: new Array(columnCount).fill(true) };
  }
  if (used.every((c) => quotedN[c] <= needed[c])) {
    return { quoteStyle: "minimal", quoted: new Array(columnCount).fill(false) };
  }
  return {
    quoteStyle: "per_column",
    quoted: nonEmpty.map((n, c) => n > 0 && quotedN[c] / n >= 0.5),
  };
}

/** Sniffs the dialect of a decoded sample. `truncated` is true when the sample is not the whole file. */
export function sniffDialect(text: string, truncated: boolean): SniffResult {
  const quote = '"';
  const lineEnding = detectLineEnding(text);
  const delimiter = pickDelimiter(text, quote, truncated);
  const { rows, quoted } = splitRecords(text, delimiter, quote, truncated);

  if (rows.length === 0) {
    return {
      delimiter,
      quote,
      header: true,
      headerQuoted: false,
      lineEnding,
      quoteStyle: "minimal",
      quoted: [],
      columnCount: 0,
      columnNames: [],
      consistent: true,
      recordsSampled: 0,
    };
  }

  const header = looksLikeHeader(rows[0], rows.slice(1));
  const { count: columnCount, share } = modalCount(rows);
  const first = rows[0];
  const dataRows = header ? rows.slice(1) : rows;
  const dataFlags = header ? quoted.slice(1) : quoted;
  const names = header ? uniqueNames(first) : Array.from({ length: columnCount }, (_, i) => `column_${i + 1}`);
  const { quoteStyle, quoted: colQuoted } = inferQuoting(dataRows, dataFlags, columnCount, delimiter, quote);

  return {
    delimiter,
    quote,
    header,
    headerQuoted: header && quoted[0].length > 0 && quoted[0].every(Boolean),
    lineEnding,
    quoteStyle,
    quoted: colQuoted,
    columnCount,
    columnNames: names.slice(0, columnCount),
    consistent: share === 1,
    recordsSampled: rows.length,
  };
}

/** True when the file ends with a line break, judged from its last bytes. */
export function hasTrailingNewline(tail: Uint8Array, encoding: Encoding): boolean {
  const n = tail.length;
  if (encoding === "utf-16le") return n >= 2 && tail[n - 1] === 0 && (tail[n - 2] === 0x0a || tail[n - 2] === 0x0d);
  if (encoding === "utf-16be") return n >= 2 && tail[n - 2] === 0 && (tail[n - 1] === 0x0a || tail[n - 1] === 0x0d);
  return n >= 1 && (tail[n - 1] === 0x0a || tail[n - 1] === 0x0d);
}
