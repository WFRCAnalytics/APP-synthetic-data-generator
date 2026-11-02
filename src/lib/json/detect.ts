// Telling the form and layout of a JSON file from a bounded head and tail of its bytes (specs/007 research R4).
// Only whitespace and the first bracket or brace are inspected, never a byte of a value, and the name of the
// file is never consulted.

import type { JsonForm, JsonIndent, JsonLayout } from "./types";

/** Bytes of the head that are looked at. */
export const HEAD_BYTES = 64 * 1024;
export const TAIL_BYTES = 4 * 1024;

const isSpace = (b: number): boolean => b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d;

export interface JsonDetection {
  /** The form, or null when the file does not start like a list of records. */
  form: JsonForm | null;
  layout: JsonLayout;
}

/**
 * @param head the first bytes of the file (up to HEAD_BYTES)
 * @param tail the last bytes of the file (up to TAIL_BYTES; may be the whole of a small file)
 */
export function detectJson(head: Uint8Array, tail: Uint8Array): JsonDetection {
  let i = 0;
  const bom = head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf;
  if (bom) i = 3;
  while (i < head.length && isSpace(head[i])) i++;
  const first = i < head.length ? head[i] : -1;
  const form: JsonForm | null = first === 0x5b ? "array" : first === 0x7b ? "lines" : null;

  // The line ending is the first line break in the head; a file with none is written with LF.
  let lineEnding: JsonLayout["lineEnding"] = "lf";
  for (let j = 0; j < head.length; j++) {
    if (head[j] === 0x0a) {
      lineEnding = j > 0 && head[j - 1] === 0x0d ? "crlf" : "lf";
      break;
    }
  }

  const last = tail.length > 0 ? tail[tail.length - 1] : -1;
  const trailingNewline = last === 0x0a;

  const layout: JsonLayout = { form: form ?? "array", indent: form === "array" ? indentOf(head, i + 1) : "compact", lineEnding, trailingNewline, bom };
  return { form, layout };
}

/**
 * The indent of an array: what comes between `[` and the first `{`. A line break there means one record is
 * spread over lines; the whitespace before the `{` is then the indent. No line break means compact.
 */
function indentOf(head: Uint8Array, from: number): JsonIndent {
  let j = from;
  let sawBreak = false;
  let tabs = 0;
  let spaces = 0;
  while (j < head.length && isSpace(head[j])) {
    if (head[j] === 0x0a) {
      sawBreak = true;
      tabs = 0;
      spaces = 0;
    } else if (head[j] === 0x09) tabs++;
    else if (head[j] === 0x20) spaces++;
    j++;
  }
  if (j >= head.length || head[j] !== 0x7b || !sawBreak) return "compact";
  if (tabs > 0) return "tab";
  return spaces === 2 ? "2" : spaces === 4 ? "4" : "compact";
}
