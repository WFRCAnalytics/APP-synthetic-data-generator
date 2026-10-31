import { describe, expect, it } from "vitest";
import { effectiveCounts, OTHER_LABEL, validateOutputName } from "../../src/lib/protections";

const counts = { a: 900, b: 60, c: 30, d: 10 };
const total = (c: Record<string, number>) => Object.values(c).reduce((x, y) => x + y, 0);

describe("protections are off by default", () => {
  it.each([{}, { merge_under_k: null }, { merge_under_k: undefined }, { label_codes: false }, { merge_under_k: null, label_codes: false }])(
    "leaves the labels alone for %j",
    (settings) => {
      expect(effectiveCounts(counts, settings)).toEqual(counts);
    },
  );
});

describe("merging rare categories into Other", () => {
  it("merges every label with fewer than k rows", () => {
    expect(effectiveCounts(counts, { merge_under_k: 100 })).toEqual({ a: 900, [OTHER_LABEL]: 100 });
  });

  it("keeps the total", () => {
    expect(total(effectiveCounts(counts, { merge_under_k: 50 }))).toBe(total(counts));
  });

  it("treats a label with exactly k rows as large enough to keep", () => {
    // b has exactly 60 rows, so it stays; c and d are under 60 and merge.
    expect(effectiveCounts({ a: 100, b: 60, c: 40, d: 30 }, { merge_under_k: 60 })).toEqual({ a: 100, b: 60, [OTHER_LABEL]: 70 });
  });

  it("does not merge a single rare label, which would only rename it", () => {
    expect(effectiveCounts({ a: 900, b: 90, c: 10 }, { merge_under_k: 50 })).toEqual({ a: 900, b: 90, c: 10 });
  });

  it("adds to an existing Other label instead of making a second one", () => {
    const merged = effectiveCounts({ a: 800, [OTHER_LABEL]: 150, b: 30, c: 20 }, { merge_under_k: 100 });
    expect(merged).toEqual({ a: 800, [OTHER_LABEL]: 200 });
  });

  it("merges nothing when no label is rare enough", () => {
    expect(effectiveCounts(counts, { merge_under_k: 2 })).toEqual(counts);
  });

  it("keeps the order of the labels that stay", () => {
    expect(Object.keys(effectiveCounts({ z: 500, y: 400, x: 5, w: 4 }, { merge_under_k: 10 }))).toEqual(["z", "y", OTHER_LABEL]);
  });

  it("ignores a k below 2", () => {
    expect(effectiveCounts(counts, { merge_under_k: 1 })).toEqual(counts);
    expect(effectiveCounts(counts, { merge_under_k: 0 })).toEqual(counts);
  });
});

describe("replacing labels with neutral codes", () => {
  it("numbers the labels in order", () => {
    expect(effectiveCounts({ Walk: 600, Bike: 400 }, { label_codes: true })).toEqual({ cat_01: 600, cat_02: 400 });
  });

  it("widens the numbers when there are 100 or more labels", () => {
    const many = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`L${i}`, 1]));
    const keys = Object.keys(effectiveCounts(many, { label_codes: true }));
    expect(keys[0]).toBe("cat_001");
    expect(keys[119]).toBe("cat_120");
  });

  it("hides every original label", () => {
    const out = effectiveCounts({ "Wasatch Elementary": 3, "Lincoln High": 2 }, { label_codes: true });
    expect(Object.keys(out).join()).not.toMatch(/Wasatch|Lincoln/);
  });

  it("keeps the counts", () => {
    expect(Object.values(effectiveCounts({ a: 5, b: 3 }, { label_codes: true }))).toEqual([5, 3]);
  });

  it("codes the merged labels when both protections are on", () => {
    expect(effectiveCounts(counts, { merge_under_k: 100, label_codes: true })).toEqual({ cat_01: 900, cat_02: 100 });
  });
});

describe("renaming columns", () => {
  const others = ["id", "mode", "dist"];

  it("accepts a new, unused name", () => {
    expect(validateOutputName("travel_mode", others)).toBeNull();
  });

  it("accepts keeping the original name when it is not taken by another column", () => {
    expect(validateOutputName("mode", ["id", "dist"])).toBeNull();
  });

  it("rejects an empty or blank name", () => {
    expect(validateOutputName("", others)).toMatch(/needs a name/);
    expect(validateOutputName("   ", others)).toMatch(/needs a name/);
  });

  it("rejects a name another column already has", () => {
    expect(validateOutputName("dist", others)).toMatch(/already has this name/);
  });

  it("rejects a line break", () => {
    expect(validateOutputName("a\nb", others)).toMatch(/line break/);
  });

  it("treats names as case sensitive, like most analysis code does", () => {
    expect(validateOutputName("Dist", others)).toBeNull();
  });
});
