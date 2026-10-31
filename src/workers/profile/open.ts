// Detects a file's settings from its first megabyte and its last few bytes (FR-002). Pure: the
// worker reads the bytes from the browser File and hands them in, tests read them from disk.

import { detectEncoding, decodeText, SAMPLE_BYTES, type Confidence } from "../../lib/encoding/detect";
import { hasTrailingNewline, sniffDialect } from "../../lib/csv/sniff";
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
