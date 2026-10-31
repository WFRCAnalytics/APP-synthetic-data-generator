// The composition core of the text generators (specs/002 research R1, R2): a keyed bijection from a
// distinct-value group to a position in a space of invented values, a suffix that extends the space
// past its natural size, and a shared mapper from a row's rank to its group. Everything is a pure
// function, so output cannot depend on chunk size.

import { describe, expect, it } from "vitest";
import { makeUniqueSpace, mixedRadix } from "../../src/lib/textgen/compose";
import { makeGroupMapper } from "../../src/lib/generate/groups";

describe("mixedRadix", () => {
  it("reads an index as digits, most significant first", () => {
    expect(mixedRadix(0, [3, 4, 5])).toEqual([0, 0, 0]);
    expect(mixedRadix(59, [3, 4, 5])).toEqual([2, 3, 4]);
    expect(mixedRadix(23, [3, 4, 5])).toEqual([1, 0, 3]);
  });

  it("covers every combination exactly once", () => {
    const radices = [3, 4, 5];
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) seen.add(mixedRadix(i, radices).join(","));
    expect(seen.size).toBe(60);
  });

  it("is exact for indexes beyond 2^32", () => {
    const radices = [3000, 1000, 26, 1000];
    const total = radices.reduce((a, b) => a * b, 1);
    expect(total).toBeGreaterThan(2 ** 32);
    const digits = mixedRadix(total - 1, radices);
    expect(digits).toEqual([2999, 999, 25, 999]);
  });
});

describe("makeUniqueSpace", () => {
  it("maps every group to a different position inside the natural space when it is big enough", () => {
    const space = makeUniqueSpace(1000, 700, 123);
    const seen = new Set<number>();
    for (let g = 0; g < 700; g++) {
      const { index, suffix } = space.map(g);
      expect(suffix).toBe(0);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(1000);
      seen.add(index);
    }
    expect(seen.size).toBe(700);
    expect(space.suffixNeeded).toBe(false);
  });

  it("adds a suffix beyond the natural space and stays unique", () => {
    const space = makeUniqueSpace(100, 350, 7);
    expect(space.suffixNeeded).toBe(true);
    const seen = new Set<string>();
    let suffixed = 0;
    for (let g = 0; g < 350; g++) {
      const { index, suffix } = space.map(g);
      expect(index).toBeLessThan(100);
      if (suffix > 0) suffixed++;
      seen.add(`${index}:${suffix}`);
    }
    expect(seen.size).toBe(350);
    expect(suffixed).toBeGreaterThan(0);
    expect(suffixed).toBeLessThan(350);
  });

  it("uses every natural position before any suffix is needed twice over", () => {
    const space = makeUniqueSpace(10, 20, 3);
    const counts = new Map<number, number>();
    for (let g = 0; g < 20; g++) counts.set(space.map(g).index, (counts.get(space.map(g).index) ?? 0) + 1);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
  });

  it("is deterministic and depends on the key", () => {
    const a = makeUniqueSpace(5000, 4000, 11);
    const b = makeUniqueSpace(5000, 4000, 11);
    const c = makeUniqueSpace(5000, 4000, 12);
    const run = (s: typeof a) => Array.from({ length: 50 }, (_, g) => s.map(g).index);
    expect(run(a)).toEqual(run(b));
    expect(run(a)).not.toEqual(run(c));
  });

  it("handles a space bigger than 2^32 without losing uniqueness on a sample", () => {
    const natural = 6_000_000_000;
    const space = makeUniqueSpace(natural, 200000, 5);
    const seen = new Set<number>();
    for (let g = 0; g < 200000; g++) {
      const { index } = space.map(g);
      expect(index).toBeLessThan(natural);
      seen.add(index);
    }
    expect(seen.size).toBe(200000);
  });

  it("handles no groups", () => {
    expect(() => makeUniqueSpace(10, 0, 1)).not.toThrow();
  });
});

describe("makeGroupMapper", () => {
  it("assigns rows to groups so each group size appears the right number of times", () => {
    const repeat = { "1": 5, "2": 3, "4": 2 };
    const mapper = makeGroupMapper(repeat);
    expect(mapper.groups).toBe(10);
    expect(mapper.rows).toBe(5 + 6 + 8);
    const perGroup = new Map<number, number>();
    for (let r = 0; r < mapper.rows; r++) perGroup.set(mapper(r), (perGroup.get(mapper(r)) ?? 0) + 1);
    expect(perGroup.size).toBe(10);
    const sizes: Record<string, number> = {};
    for (const n of perGroup.values()) sizes[n] = (sizes[n] ?? 0) + 1;
    expect(sizes).toEqual(repeat);
  });

  it("numbers groups from 0 to groups - 1", () => {
    const mapper = makeGroupMapper({ "3": 4 });
    const groups = new Set(Array.from({ length: 12 }, (_, r) => mapper(r)));
    expect([...groups].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("is a pure function of the row", () => {
    const a = makeGroupMapper({ "1": 100, "2": 50 });
    const b = makeGroupMapper({ "2": 50, "1": 100 });
    for (const r of [0, 1, 50, 99, 100, 199]) expect(a(r)).toBe(b(r));
  });

  it("ignores empty buckets", () => {
    const mapper = makeGroupMapper({ "1": 0, "2": 3 });
    expect(mapper.groups).toBe(3);
    expect(mapper.rows).toBe(6);
  });
});
