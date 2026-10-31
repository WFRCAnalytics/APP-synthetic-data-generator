// Counting distinct values and how often each repeats, without keeping the values (specs/002 FR-012).
// A column of millions of unique values would need hundreds of megabytes as a Map of strings. Here
// every value becomes a 53-bit hash in a growing array of numbers (8 bytes each); sorting the array
// and reading its runs gives the exact distinct count and repeat structure, up to hash collisions
// (about one in a thousand for five million values, and never in favour of a pass: a collision can
// only make two different values count as one).

/** cyrb53, a public-domain 53-bit string hash. */
export function hash53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const CHUNK = 1 << 20;

export class DistinctCounter {
  private chunks: Float64Array[] = [];
  private used = 0;

  add(value: string): void {
    if (this.used === this.chunks.length * CHUNK) this.chunks.push(new Float64Array(CHUNK));
    this.chunks[this.chunks.length - 1][this.used % CHUNK] = hash53(value);
    this.used++;
  }

  /** Number of values added. */
  get size(): number {
    return this.used;
  }

  /** Group size to the number of distinct values with that size, and the distinct count. */
  finish(): { structure: Record<string, number>; distinct: number } {
    const all = new Float64Array(this.used);
    this.chunks.forEach((c, i) => all.set(c.subarray(0, Math.min(CHUNK, this.used - i * CHUNK)), i * CHUNK));
    this.chunks = [];
    all.sort();
    const structure: Record<string, number> = {};
    let distinct = 0;
    let run = 0;
    for (let i = 0; i < all.length; i++) {
      if (i > 0 && all[i] === all[i - 1]) run++;
      else {
        if (run > 0) structure[run] = (structure[run] ?? 0) + 1;
        run = 1;
        distinct++;
      }
    }
    if (run > 0) structure[run] = (structure[run] ?? 0) + 1;
    return { structure, distinct };
  }
}
