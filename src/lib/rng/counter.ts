// Counter-based draws: a value that depends only on (key, row), never on how many draws came
// before. This is what makes output independent of chunk size (research.md R5).

import { createRng, mix32, type Rng } from "./sfc32";

/** A uniform float in [0, 1) for one row, with 53 bits of resolution. */
export function drawUniform(key: number, row: number, stream = 0): number {
  const base = mix32((key ^ Math.imul(row + 1, 0x9e3779b1)) >>> 0);
  const hi = mix32((base ^ Math.imul(stream + 1, 0x85ebca6b)) >>> 0) >>> 5; // 27 bits
  const lo = mix32((base + 0x7f4a7c15 + stream) >>> 0) >>> 6; // 26 bits
  return (hi * 67108864 + lo) / 9007199254740992;
}

/**
 * A short sequential generator seeded from (key, row). Use it when one row needs several draws
 * (for example gamma sampling), so those draws still depend on nothing but the row.
 */
export function rowRng(key: number, row: number): Rng {
  return createRng(mix32((key ^ Math.imul(row + 1, 0x9e3779b1)) >>> 0));
}
