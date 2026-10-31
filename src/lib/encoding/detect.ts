// Detects a CSV file's text encoding from its first bytes (FR-002): UTF-8 (with or without BOM),
// UTF-16 LE/BE, and Windows-1252 as the fallback. Pure functions, no I/O.

export type Encoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";
export type Confidence = "high" | "medium" | "low";

export interface Detection {
  encoding: Encoding;
  bom: boolean;
  confidence: Confidence;
  /** True when a UTF-32 BOM was found; that encoding is not supported. */
  unsupported?: boolean;
}

export const SAMPLE_BYTES = 1024 * 1024;

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((b, i) => bytes[i] === b);
}

/** Strict UTF-8 validity check that tolerates a multi-byte character cut off at the end. */
export function isValidUtf8(bytes: Uint8Array): boolean {
  // Back off up to 3 bytes so a character split by the sample boundary is not a false failure.
  for (let trim = 0; trim <= 3 && trim <= bytes.length; trim++) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, bytes.length - trim));
      return true;
    } catch {
      // try trimming more
    }
  }
  return false;
}

function utf16Pattern(bytes: Uint8Array): "utf-16le" | "utf-16be" | null {
  const n = Math.min(bytes.length, 4096) & ~1;
  if (n < 4) return null;
  let evenZero = 0;
  let oddZero = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) evenZero++;
    if (bytes[i + 1] === 0) oddZero++;
  }
  const pairs = n / 2;
  // ASCII-heavy UTF-16 has a zero in every other byte.
  if (oddZero / pairs > 0.3 && evenZero / pairs < 0.05) return "utf-16le";
  if (evenZero / pairs > 0.3 && oddZero / pairs < 0.05) return "utf-16be";
  return null;
}

export function detectEncoding(bytes: Uint8Array): Detection {
  if (startsWith(bytes, [0xff, 0xfe, 0x00, 0x00]) || startsWith(bytes, [0x00, 0x00, 0xfe, 0xff])) {
    return { encoding: "utf-16le", bom: true, confidence: "high", unsupported: true };
  }
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return { encoding: "utf-8", bom: true, confidence: "high" };
  if (startsWith(bytes, [0xff, 0xfe])) return { encoding: "utf-16le", bom: true, confidence: "high" };
  if (startsWith(bytes, [0xfe, 0xff])) return { encoding: "utf-16be", bom: true, confidence: "high" };

  const sample = bytes.subarray(0, SAMPLE_BYTES);
  const wide = utf16Pattern(sample);
  if (wide) return { encoding: wide, bom: false, confidence: "medium" };

  if (isValidUtf8(sample)) {
    const ascii = sample.every((b) => b < 0x80);
    return { encoding: "utf-8", bom: false, confidence: ascii ? "medium" : "high" };
  }
  // Not valid UTF-8, so assume the common single-byte Windows encoding. Other legacy encodings
  // (Shift-JIS, GB18030 and so on) cannot be told apart from it and will look garbled.
  return { encoding: "windows-1252", bom: false, confidence: "low" };
}

/** Decodes bytes with the given encoding, skipping a matching BOM. Used only for headers and tests. */
export function decodeText(bytes: Uint8Array, encoding: Encoding): string {
  let body = bytes;
  if (encoding === "utf-8" && startsWith(bytes, [0xef, 0xbb, 0xbf])) body = bytes.subarray(3);
  if (encoding === "utf-16le" && startsWith(bytes, [0xff, 0xfe])) body = bytes.subarray(2);
  if (encoding === "utf-16be" && startsWith(bytes, [0xfe, 0xff])) body = bytes.subarray(2);
  return new TextDecoder(encoding).decode(body);
}
