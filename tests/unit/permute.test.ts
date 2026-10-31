import { describe, expect, it } from "vitest";
import { makePermutation, makePermutationBig } from "../../src/lib/rng/permute";

function isBijection(n: number, key: number): boolean {
  const p = makePermutation(n, key);
  const seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = p(i);
    if (x < 0 || x >= n || seen[x]) return false;
    seen[x] = 1;
  }
  return true;
}

describe("keyed permutation (number path)", () => {
  it.each([1, 2, 3, 7, 100, 1000, 4097, 65537])("is a bijection over [0, %i)", (n) => {
    expect(isBijection(n, 12345)).toBe(true);
  });

  it("is deterministic for the same key", () => {
    const a = makePermutation(1000, 5);
    const b = makePermutation(1000, 5);
    for (let i = 0; i < 1000; i++) expect(a(i)).toBe(b(i));
  });

  it("gives different orders for different keys", () => {
    const a = makePermutation(1000, 1);
    const b = makePermutation(1000, 2);
    let same = 0;
    for (let i = 0; i < 1000; i++) if (a(i) === b(i)) same++;
    expect(same).toBeLessThan(50);
  });

  it("scatters nearby indexes instead of keeping them in order", () => {
    const p = makePermutation(100000, 9);
    let ascending = 0;
    for (let i = 1; i < 1000; i++) if (p(i) > p(i - 1)) ascending++;
    expect(ascending).toBeGreaterThan(400);
    expect(ascending).toBeLessThan(600);
  });

  it("handles a domain of exactly 2^32 without overflow", () => {
    const p = makePermutation(2 ** 32, 3);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const x = p(i);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(2 ** 32);
      seen.add(x);
    }
    expect(seen.size).toBe(2000);
  });

  it("rejects invalid sizes and indexes", () => {
    expect(() => makePermutation(0, 1)).toThrow(RangeError);
    expect(() => makePermutation(2 ** 32 + 1, 1)).toThrow(RangeError);
    const p = makePermutation(10, 1);
    expect(() => p(10)).toThrow(RangeError);
    expect(() => p(-1)).toThrow(RangeError);
  });

  it("a one-value domain always returns 0", () => {
    expect(makePermutation(1, 99)(0)).toBe(0);
  });
});

describe("keyed permutation (BigInt path)", () => {
  it("is a bijection over a small domain", () => {
    const n = 1000n;
    const p = makePermutationBig(n, 77);
    const seen = new Set<bigint>();
    for (let i = 0n; i < n; i++) {
      const x = p(i);
      expect(x >= 0n && x < n).toBe(true);
      seen.add(x);
    }
    expect(seen.size).toBe(1000);
  });

  it("gives distinct in-range values over a huge domain", () => {
    const n = 10n ** 20n;
    const p = makePermutationBig(n, 5);
    const seen = new Set<bigint>();
    for (let i = 0n; i < 3000n; i++) {
      const x = p(i);
      expect(x >= 0n && x < n).toBe(true);
      seen.add(x);
    }
    expect(seen.size).toBe(3000);
  });

  it("is deterministic and key dependent", () => {
    const n = 10n ** 15n;
    expect(makePermutationBig(n, 1)(5n)).toBe(makePermutationBig(n, 1)(5n));
    expect(makePermutationBig(n, 1)(5n)).not.toBe(makePermutationBig(n, 2)(5n));
  });

  it("rejects an index outside the domain", () => {
    expect(() => makePermutationBig(10n, 1)(10n)).toThrow(RangeError);
    expect(() => makePermutationBig(0n, 1)).toThrow(RangeError);
  });
});
