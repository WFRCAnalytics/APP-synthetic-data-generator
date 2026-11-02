// From the cell text the generators produce to a JSON token (specs/007 research R5). One converter per key holds
// the key's kind and counts what it could not write as asked: text that is not a number, a yes or a no
// ("unparsed", written as null). Nothing here reads a real value.

import { EMPTY_TEXT_TOKEN } from "../spec/types";
import type { JsonKind } from "./types";

export interface JsonConvertStats {
  /** Text that was not a value of the key's kind, written as null. */
  unparsed: number;
}

export interface JsonConverter {
  /** The JSON token for a cell text (never the NA text). */
  token(text: string): string;
  stats: JsonConvertStats;
}

const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const TRUE = /^(true|t|yes|y|1)$/i;
const FALSE = /^(false|f|no|n|0)$/i;

/** The JSON text of a string, with only the characters JSON requires escaped. */
export function jsonString(text: string): string {
  let out = '"';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += "\\\\";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else if (c < 0x20) out += `\\u${c.toString(16).padStart(4, "0")}`;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1];
        i++;
      } else out += `\\u${c.toString(16)}`; // a lone surrogate cannot be UTF-8; keep it as an escape
    } else if (c >= 0xdc00 && c <= 0xdfff) out += `\\u${c.toString(16)}`;
    else out += text[i];
  }
  return `${out}"`;
}

/** A number as JSON text, or null when the text is not a finite number. */
export function jsonNumber(text: string): string | null {
  const t = text.trim();
  if (NUMBER.test(t)) return t;
  if (t === "" || /[^0-9eE+.\-]/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? String(n) : null;
}

export function createJsonConverter(kind: JsonKind): JsonConverter {
  const stats: JsonConvertStats = { unparsed: 0 };
  return {
    stats,
    token(text) {
      switch (kind) {
        case "number": {
          const n = jsonNumber(text);
          if (n === null) {
            stats.unparsed++;
            return "null";
          }
          return n;
        }
        case "boolean": {
          if (TRUE.test(text.trim())) return "true";
          if (FALSE.test(text.trim())) return "false";
          stats.unparsed++;
          return "null";
        }
        case "string":
          return jsonString(text === EMPTY_TEXT_TOKEN ? "" : text);
        default:
          return "null"; // a null-only, object or array key is never given a value
      }
    },
  };
}
