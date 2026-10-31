// Per-column sub-seeds (constitution Principle V): each column's seed depends only on the global
// seed and that column's name, so changing one column's settings can never change another
// column's output.

import { mix32 } from "./sfc32";

const encoder = new TextEncoder();

/** FNV-1a over the UTF-8 bytes of a string. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (const byte of encoder.encode(text)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Derives a 32-bit sub-seed from the global seed and a column name. */
export function subSeed(globalSeed: number, columnName: string): number {
  return mix32((mix32(globalSeed >>> 0) ^ fnv1a(columnName)) >>> 0);
}
