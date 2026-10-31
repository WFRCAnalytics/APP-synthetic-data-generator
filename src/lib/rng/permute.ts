// Keyed bijection over [0, n): a Feistel network with cycle-walking. It maps every row index to a
// distinct "rank" in [0, n), so exact counts (NA rows, sentinel rows, label counts) can be placed
// at random-looking rows without ever holding a shuffled array in memory (research.md R5).
//
// Two paths: plain numbers when n <= 2^32 (the fast path every row uses), and BigInt for the huge
// domains an ID mask can have.

import { mix32 } from "./sfc32";

const ROUNDS = 6;
const MAX_FAST = 2 ** 32;

function roundFn(key: number, round: number, x: number): number {
  return mix32((x ^ Math.imul(key >>> 0, 0x9e3779b1) ^ Math.imul(round + 1, 0x85ebca6b)) >>> 0);
}

/** Returns i -> permuted rank, for a domain of n <= 2^32 values. */
export function makePermutation(n: number, key: number): (i: number) => number {
  if (!Number.isInteger(n) || n < 1) throw new RangeError("permutation size must be a positive integer");
  if (n > MAX_FAST) throw new RangeError("use makePermutationBig for domains above 2^32");
  if (n === 1) return () => 0;

  // Smallest even bit width 2k with 2^(2k) >= n, so the domain splits into two k-bit halves.
  let k = 1;
  while (2 ** (2 * k) < n) k++;
  const mask = k >= 32 ? 0xffffffff : 2 ** k - 1;
  const shift = 2 ** k;

  const feistel = (x: number): number => {
    let left = Math.floor(x / shift);
    let right = x % shift;
    for (let r = 0; r < ROUNDS; r++) {
      const f = roundFn(key, r, right) & mask;
      const nextRight = ((left ^ f) >>> 0) & mask;
      left = right;
      right = nextRight;
    }
    return left * shift + right;
  };

  return (i: number): number => {
    if (!Number.isInteger(i) || i < 0 || i >= n) throw new RangeError("index outside the permutation domain");
    let x = feistel(i);
    while (x >= n) x = feistel(x); // cycle-walk back into [0, n)
    return x;
  };
}

function roundSeed(key: number, round: number): number {
  return (Math.imul(key >>> 0, 0x9e3779b1) ^ Math.imul(round + 1, 0x85ebca6b)) >>> 0;
}

// Round function for the BigInt path: fold the half into one 32-bit value, then expand it to
// enough 32-bit words to cover a k-bit half.
function bigRound(key: number, round: number, x: bigint, k: bigint): bigint {
  let acc = roundSeed(key, round);
  let rest = x;
  do {
    acc = mix32((acc ^ Number(rest & 0xffffffffn)) >>> 0);
    rest >>= 32n;
  } while (rest > 0n);

  const words = Number((k + 31n) / 32n);
  let out = 0n;
  let state = acc;
  for (let w = 0; w < words; w++) {
    state = mix32((state + 0x9e3779b9) >>> 0);
    out = (out << 32n) | BigInt(state);
  }
  return out & ((1n << k) - 1n);
}

/** Same bijection for any size, using BigInt. Slower; meant for domains above 2^32. */
export function makePermutationBig(n: bigint, key: number): (i: bigint) => bigint {
  if (n < 1n) throw new RangeError("permutation size must be a positive integer");
  if (n === 1n) return () => 0n;

  let k = 1n;
  while (1n << (2n * k) < n) k++;
  const mask = (1n << k) - 1n;

  const feistel = (x: bigint): bigint => {
    let left = x >> k;
    let right = x & mask;
    for (let r = 0; r < ROUNDS; r++) {
      const f = bigRound(key, r, right, k);
      const nextRight = (left ^ f) & mask;
      left = right;
      right = nextRight;
    }
    return (left << k) | right;
  };

  return (i: bigint): bigint => {
    if (i < 0n || i >= n) throw new RangeError("index outside the permutation domain");
    let x = feistel(i);
    while (x >= n) x = feistel(x);
    return x;
  };
}
