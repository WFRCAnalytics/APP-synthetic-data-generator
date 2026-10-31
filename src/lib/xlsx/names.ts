// Column letters, cell ranges and sheet names, the vocabulary of a worksheet (specs/003 FR-001,
// FR-002, FR-011). Pure code with no dependency on the package format.

export const MAX_COLUMNS = 16384; // A to XFD
export const MAX_ROWS = 1048576;

/** The letters of a zero-based column index: 0 is A, 25 is Z, 26 is AA, 16383 is XFD. */
export function columnLetters(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_COLUMNS) throw new RangeError("Column index out of range.");
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** The zero-based index of column letters (case does not matter). */
export function columnIndex(letters: string): number {
  if (!/^[A-Za-z]{1,3}$/.test(letters)) throw new RangeError("Not a column.");
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  if (n > MAX_COLUMNS) throw new RangeError("Column out of range.");
  return n - 1;
}

/** A cell reference such as A1 from a zero-based column and row. */
export const cellRef = (col: number, row: number): string => `${columnLetters(col)}${row + 1}`;

export interface CellRange {
  firstCol: number;
  firstRow: number;
  lastCol: number;
  lastRow: number;
}

const CELL = /^\$?([A-Za-z]{1,3})\$?([1-9]\d{0,6})$/;

function parseCell(text: string): { col: number; row: number } | null {
  const m = CELL.exec(text.trim());
  if (!m) return null;
  try {
    const col = columnIndex(m[1]);
    const row = Number(m[2]) - 1;
    return row < MAX_ROWS ? { col, row } : null;
  } catch {
    return null;
  }
}

/** Reads `A3:I203` (or a single cell, or one with $ signs) as a range; null when it is not a valid, forward range. */
export function parseRange(text: string): CellRange | null {
  const parts = text.split(":");
  if (parts.length > 2) return null;
  const a = parseCell(parts[0]);
  const b = parts.length === 2 ? parseCell(parts[1]) : a;
  if (!a || !b) return null;
  if (b.col < a.col || b.row < a.row) return null;
  return { firstCol: a.col, firstRow: a.row, lastCol: b.col, lastRow: b.row };
}

export const formatRange = (r: CellRange): string => `${cellRef(r.firstCol, r.firstRow)}:${cellRef(r.lastCol, r.lastRow)}`;

/** The rules Excel applies to a sheet name: 1 to 31 characters, none of []:*?/\ and no apostrophe at either end. */
export function isValidSheetName(name: string): boolean {
  if (name.trim() === "" || name.length > 31) return false;
  if (/[\][:*?/\\]/.test(name)) return false;
  return !(name.startsWith("'") || name.endsWith("'"));
}
