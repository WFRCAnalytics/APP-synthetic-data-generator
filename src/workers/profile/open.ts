// Detects a file's settings from its first megabyte and its last few bytes (FR-002). Pure: the
// worker reads the bytes from the browser File and hands them in, tests read them from disk.

import { detectEncoding, decodeText, SAMPLE_BYTES, type Confidence } from "../../lib/encoding/detect";
import { hasTrailingNewline, inferQuoting, sniffDialect, splitRecords, uniqueNames } from "../../lib/csv/sniff";
import type { FileSettings } from "../../lib/profile/types";

export const HEAD_BYTES = SAMPLE_BYTES;
export const TAIL_BYTES = 8;

export interface OpenResult {
  settings: FileSettings;
  /** Unique names from the header (or column_1, column_2, ...). */
  columnNames: string[];
  confidence: Confidence;
  /** False when records in the sample have different field counts (a ragged file). */
  consistent: boolean;
  /** True for a UTF-32 file, which this version cannot read. */
  unsupportedEncoding: boolean;
  /** True when the file has no records at all. */
  empty: boolean;
}

/**
 * @param head the first bytes of the file (up to HEAD_BYTES)
 * @param tail the last few bytes of the file
 * @param fileSize the whole file's size, to know whether `head` is all of it
 */
export function detectFileSettings(head: Uint8Array, tail: Uint8Array, fileSize: number): OpenResult {
  const detected = detectEncoding(head);
  const text = decodeText(head, detected.encoding);
  const sniff = sniffDialect(text, fileSize > head.length);

  return {
    settings: {
      encoding: detected.encoding,
      bom: detected.bom,
      delimiter: sniff.delimiter,
      quote: sniff.quote,
      quoteStyle: sniff.quoteStyle,
      lineEnding: sniff.lineEnding,
      header: sniff.header,
      headerQuoted: sniff.headerQuoted,
      trailingNewline: hasTrailingNewline(tail, detected.encoding),
    },
    columnNames: sniff.columnNames,
    confidence: detected.confidence,
    consistent: sniff.consistent,
    unsupportedEncoding: detected.unsupported === true,
    empty: sniff.recordsSampled === 0,
  };
}

/** Per-column "was quoted" flags need the sniffed result, so they are returned separately. */
export function detectQuotedColumns(head: Uint8Array, fileSize: number): boolean[] {
  const detected = detectEncoding(head);
  return sniffDialect(decodeText(head, detected.encoding), fileSize > head.length).quoted;
}

/**
 * Column names for the settings the user confirmed or edited: the header row if there is one,
 * otherwise column_1, column_2, ... Re-derived from the first bytes whenever the delimiter, quote
 * or header setting changes.
 */
export function columnNamesFor(head: Uint8Array, settings: FileSettings, fileSize: number): string[] {
  const text = decodeText(head, settings.encoding);
  const { rows } = splitRecords(text, settings.delimiter, settings.quote, fileSize > head.length, 1);
  const first = rows[0] ?? [];
  if (settings.header) return uniqueNames(first);
  return Array.from({ length: first.length }, (_, i) => `column_${i + 1}`);
}

/**
 * Quote style and per-column quoting for the settings the user confirmed, read from the first
 * bytes. Re-derived after the delimiter or header changes, since both change how fields split.
 */
export function quotingFor(
  head: Uint8Array,
  settings: FileSettings,
  columnCount: number,
  fileSize: number,
): { quoteStyle: FileSettings["quoteStyle"]; quoted: boolean[]; headerQuoted: boolean } {
  const text = decodeText(head, settings.encoding);
  const { rows, quoted } = splitRecords(text, settings.delimiter, settings.quote, fileSize > head.length);
  const dataRows = settings.header ? rows.slice(1) : rows;
  const dataFlags = settings.header ? quoted.slice(1) : quoted;
  const result = inferQuoting(dataRows, dataFlags, columnCount, settings.delimiter, settings.quote);
  return {
    quoteStyle: result.quoteStyle,
    quoted: result.quoted,
    headerQuoted: settings.header && quoted[0] !== undefined && quoted[0].length > 0 && quoted[0].every(Boolean),
  };
}
