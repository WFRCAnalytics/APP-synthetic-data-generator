// Text encoders for the export (FR-002, FR-028): UTF-8, UTF-16 LE/BE and Windows-1252, written with
// the same encoding as the input. Characters that the target encoding cannot represent become "?"
// and are counted, so the caller can warn instead of failing silently.

import type { Encoding } from "../encoding/detect";

export interface Encoded {
  bytes: Uint8Array;
  /** Number of characters replaced with "?" because the encoding cannot represent them. */
  replaced: number;
}

export function bomFor(encoding: Encoding): Uint8Array {
  switch (encoding) {
    case "utf-8":
      return Uint8Array.from([0xef, 0xbb, 0xbf]);
    case "utf-16le":
      return Uint8Array.from([0xff, 0xfe]);
    case "utf-16be":
      return Uint8Array.from([0xfe, 0xff]);
    default:
      return new Uint8Array(0);
  }
}

// Windows-1252 differs from Latin-1 only in 0x80-0x9F; these are the characters it puts there.
// The five undefined slots map to the same C1 control code points (the WHATWG behavior).
const CP1252_HIGH: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

function encodeUtf16(text: string, bigEndian: boolean): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i); // surrogate pairs pass through as two code units
    if (bigEndian) {
      out[i * 2] = unit >> 8;
      out[i * 2 + 1] = unit & 0xff;
    } else {
      out[i * 2] = unit & 0xff;
      out[i * 2 + 1] = unit >> 8;
    }
  }
  return out;
}

function encodeCp1252(text: string): Encoded {
  const bytes: number[] = [];
  let replaced = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) bytes.push(cp);
    else if (CP1252_HIGH[cp] !== undefined) bytes.push(CP1252_HIGH[cp]);
    else if (cp >= 0x80 && cp <= 0x9f) bytes.push(cp); // C1 controls map to themselves
    else {
      bytes.push(0x3f);
      replaced++;
    }
  }
  return { bytes: Uint8Array.from(bytes), replaced };
}

/** Encodes text (no BOM; use bomFor once at the start of a file). */
export function encodeText(text: string, encoding: Encoding): Encoded {
  switch (encoding) {
    case "utf-8":
      return { bytes: new TextEncoder().encode(text), replaced: 0 };
    case "utf-16le":
      return { bytes: encodeUtf16(text, false), replaced: 0 };
    case "utf-16be":
      return { bytes: encodeUtf16(text, true), replaced: 0 };
    case "windows-1252":
      return encodeCp1252(text);
  }
}
