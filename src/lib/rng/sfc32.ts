// Small, fast, seedable 32-bit generator (sfc32) with a splitmix32 seeder. Used wherever a
// sequential stream of draws is fine (samplers). Per-row, order-independent draws use
// counter.ts instead.

export type Rng = () => number;

/** Mixes a 32-bit integer (the murmur3 finalizer). Good avalanche, cheap. */
export function mix32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    return mix32(a);
  };
}

/** sfc32 from four 32-bit words. Returns floats in [0, 1). */
export function sfc32(a: number, b: number, c: number, d: number): Rng {
  a >>>= 0;
  b >>>= 0;
  c >>>= 0;
  d >>>= 0;
  return () => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
}

/** A generator seeded from one 32-bit integer, warmed up so nearby seeds diverge immediately. */
export function createRng(seed: number): Rng {
  const next = splitmix32(seed);
  const rng = sfc32(next(), next(), next(), next());
  for (let i = 0; i < 12; i++) rng();
  return rng;
}
