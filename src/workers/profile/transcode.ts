// Fallback for encodings DuckDB cannot read natively (research.md, R2 follow-up): UTF-16 big
// endian and every Windows-1252 file. The file is decoded as a stream and re-encoded as UTF-8 into
// one in-memory buffer, which is then registered with DuckDB. Nothing is written to disk, so a
// reload still clears everything (constitution Principle I). The buffer sits in memory beside the
// table, so these files need roughly twice the memory; the size warning says so.

import type { Encoding } from "../../lib/encoding/detect";

/** How DuckDB should read a file in the given encoding. */
export type ReadMode = { kind: "native"; encoding: "utf-8" | "utf-16" } | { kind: "transcode" };

export function readModeFor(encoding: Encoding): ReadMode {
  switch (encoding) {
    case "utf-8":
      return { kind: "native", encoding: "utf-8" };
    case "utf-16le":
      return { kind: "native", encoding: "utf-16" };
    default:
      return { kind: "transcode" };
  }
}

/**
 * Decodes `source` with `encoding` and returns its UTF-8 bytes. The stream is read in pieces, so
 * the only whole-file allocation is the result.
 */
export async function transcodeToUtf8(
  source: Blob,
  encoding: Encoding,
  onProgress?: (bytesRead: number, total: number) => void,
): Promise<Uint8Array> {
  const decoded = source.stream().pipeThrough(new TextDecoderStream(encoding));
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  let length = 0;
  let consumed = 0;

  const reader = decoded.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const bytes = encoder.encode(value);
    parts.push(bytes);
    length += bytes.length;
    // Characters, not source bytes, but close enough for a progress bar.
    consumed += value.length;
    onProgress?.(Math.min(consumed, source.size), source.size);
  }

  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
