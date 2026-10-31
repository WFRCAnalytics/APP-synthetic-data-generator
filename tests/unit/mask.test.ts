import { describe, expect, it } from "vitest";
import {
  alphabetOf,
  idCapacity,
  isNumericMask,
  maskCapacity,
  maskToRegexString,
  maskValueAt,
  maskValueAtNumber,
  matchesMask,
  tokenForPosition,
} from "../../src/lib/mask/mask";
import { groupsNeeded, IdPatternError, makeIdGenerator, rowsCovered, sampleIds } from "../../src/lib/generate/survey-id";
import type { MaskToken } from "../../src/lib/spec/types";

const digits = (n: number): MaskToken[] => Array.from({ length: n }, () => "digit");
const site: MaskToken[] = [{ literal: "U" }, { literal: "T" }, { literal: "-" }, "digit", "digit", "digit", { literal: "-" }, "digit", "digit", "digit"];

describe("mask alphabets and capacity", () => {
  it("knows each token's characters", () => {
    expect(alphabetOf("digit")).toHaveLength(10);
    expect(alphabetOf("upper")).toHaveLength(26);
    expect(alphabetOf("lower")).toHaveLength(26);
    expect(alphabetOf("letter")).toHaveLength(52);
    expect(alphabetOf("alnum")).toHaveLength(62);
    expect(alphabetOf({ literal: "-" })).toBe("-");
  });

  it("multiplies positions to get the capacity, a literal counting once", () => {
    expect(maskCapacity(digits(5))).toBe(100000n);
    expect(maskCapacity(site)).toBe(1_000_000n);
    expect(maskCapacity(["upper", "upper", "digit"])).toBe(26n * 26n * 10n);
    expect(maskCapacity([])).toBe(1n);
  });

  it("limits a whole-number pattern to its min and max", () => {
    expect(idCapacity(digits(5), 10000, 59874)).toBe(49875n);
    expect(idCapacity(digits(3), 0, 5000)).toBe(1000n); // the pattern is the tighter limit
    expect(idCapacity(digits(5))).toBe(100000n);
    expect(idCapacity(site, 1, 5)).toBe(1_000_000n); // a min and max mean nothing for a text pattern
  });

  it("copes with patterns far bigger than a double can count", () => {
    expect(maskCapacity(digits(30))).toBe(10n ** 30n);
  });

  it("knows a numeric pattern", () => {
    expect(isNumericMask(digits(4))).toBe(true);
    expect(isNumericMask(site)).toBe(false);
    expect(isNumericMask([])).toBe(false);
  });
});

describe("reading an index as an ID", () => {
  it("is a bijection over a small pattern", () => {
    const mask: MaskToken[] = [{ literal: "A" }, "digit", "upper"];
    const seen = new Set<string>();
    for (let i = 0; i < 260; i++) {
      const id = maskValueAtNumber(mask, i);
      expect(matchesMask(id, mask)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(260);
  });

  it("agrees between the number and the BigInt versions", () => {
    for (const i of [0, 1, 25, 26, 12345, 999999]) expect(maskValueAt(site, BigInt(i))).toBe(maskValueAtNumber(site, i));
  });

  it("starts at the first characters and ends at the last", () => {
    expect(maskValueAtNumber(digits(3), 0)).toBe("000");
    expect(maskValueAtNumber(digits(3), 999)).toBe("999");
    expect(maskValueAtNumber(["upper", "upper"], 0)).toBe("AA");
    expect(maskValueAtNumber(["upper", "upper"], 675)).toBe("ZZ");
  });
});

describe("showing and checking a pattern", () => {
  it("writes a readable form with runs", () => {
    expect(maskToRegexString(digits(5))).toBe("[0-9]{5}");
    expect(maskToRegexString(site)).toBe("UT-[0-9]{3}-[0-9]{3}");
    expect(maskToRegexString(["upper", "lower", "letter", "alnum", "digit"])).toBe("[A-Z][a-z][A-Za-z][A-Za-z0-9][0-9]");
    expect(maskToRegexString([{ literal: "H" }, { literal: "H" }, ...digits(7)])).toBe("HH[0-9]{7}");
  });

  it("matches an ID only when every position and the length fit", () => {
    expect(matchesMask("UT-102-884", site)).toBe(true);
    expect(matchesMask("UT-102-88", site)).toBe(false);
    expect(matchesMask("XT-102-884", site)).toBe(false);
    expect(matchesMask("UT-1a2-884", site)).toBe(false);
  });
});

describe("describing a position from what was seen there", () => {
  const base = { distinct: 5, first: "x", allDigits: false, allUpper: false, allLower: false, allLetters: false };
  it("keeps a repeated letter or symbol as a literal, but not a repeated digit", () => {
    expect(tokenForPosition({ ...base, distinct: 1, first: "-" })).toEqual({ literal: "-" });
    expect(tokenForPosition({ ...base, distinct: 1, first: "H", allUpper: true, allLetters: true })).toEqual({ literal: "H" });
    expect(tokenForPosition({ ...base, distinct: 1, first: "1", allDigits: true })).toBe("digit");
  });

  it("picks the narrowest class that fits", () => {
    expect(tokenForPosition({ ...base, allDigits: true })).toBe("digit");
    expect(tokenForPosition({ ...base, allUpper: true, allLetters: true })).toBe("upper");
    expect(tokenForPosition({ ...base, allLower: true, allLetters: true })).toBe("lower");
    expect(tokenForPosition({ ...base, allLetters: true })).toBe("letter");
    expect(tokenForPosition({ ...base })).toBe("alnum");
  });
});

describe("generating IDs with the same repeat structure", () => {
  const repeat = { "1": 300, "2": 500, "4": 100 }; // 300 + 1000 + 400 = 1700 rows over 900 IDs

  it("counts what the structure needs", () => {
    expect(groupsNeeded(repeat)).toBe(900);
    expect(rowsCovered(repeat)).toBe(1700);
  });

  function all(plan: Parameters<typeof makeIdGenerator>[0], key = 1) {
    const gen = makeIdGenerator(plan, key);
    return { gen, ids: Array.from({ length: rowsCovered(plan.repeat_structure) }, (_, v) => gen(v)) };
  }

  it("gives exactly as many IDs once, twice and four times as the source", () => {
    const { ids } = all({ mask: digits(5), min: 10000, max: 99999, repeat_structure: repeat });
    const perId = new Map<string, number>();
    for (const id of ids) perId.set(id, (perId.get(id) ?? 0) + 1);
    const sizes: Record<string, number> = {};
    for (const n of perId.values()) sizes[n] = (sizes[n] ?? 0) + 1;
    expect(sizes).toEqual({ "1": 300, "2": 500, "4": 100 });
    expect(perId.size).toBe(900);
  });

  it("keeps whole-number IDs inside the min and max", () => {
    const { ids } = all({ mask: digits(5), min: 10000, max: 59874, repeat_structure: repeat });
    const nums = ids.map(Number);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(10000);
    expect(Math.max(...nums)).toBeLessThanOrEqual(59874);
  });

  it("pads with leading zeros when the source did", () => {
    const { ids } = all({ mask: digits(5), min: 1, max: 99999, pad_width: 5, repeat_structure: repeat });
    expect(ids.every((id) => /^\d{5}$/.test(id))).toBe(true);
    expect(ids.some((id) => id.startsWith("0"))).toBe(true);
  });

  it("does not pad when the source did not", () => {
    const { ids } = all({ mask: digits(5), min: 1, max: 99999, repeat_structure: repeat });
    expect(ids.some((id) => id.length < 5)).toBe(true);
  });

  it("fits a pattern with letters and fixed characters", () => {
    const { ids } = all({ mask: site, repeat_structure: repeat });
    expect(ids.every((id) => matchesMask(id, site))).toBe(true);
    expect(new Set(ids).size).toBe(900);
  });

  it("uses every ID when the structure needs the whole pattern", () => {
    const mask: MaskToken[] = ["digit", "digit"];
    const { ids } = all({ mask, repeat_structure: { "1": 100 } });
    expect(new Set(ids).size).toBe(100);
  });

  it("handles a pattern bigger than 2^32 (twelve digits)", () => {
    const { ids } = all({ mask: digits(12), min: 300000000000, max: 399999999999, repeat_structure: { "1": 200, "3": 50 } });
    expect(new Set(ids).size).toBe(250);
    expect(ids.every((id) => /^3\d{11}$/.test(id))).toBe(true);
  });

  it("is the same for the same key and different for another", () => {
    const plan = { mask: digits(6), repeat_structure: repeat };
    expect(all(plan, 5).ids).toEqual(all(plan, 5).ids);
    expect(all(plan, 5).ids).not.toEqual(all(plan, 6).ids);
  });

  it("does not repeat the source's IDs: nothing about them is known to the generator", () => {
    const gen = makeIdGenerator({ mask: digits(5), min: 10000, max: 99999, repeat_structure: { "1": 5 } }, 1);
    expect(gen.groups).toBe(5);
    expect(gen.capacity).toBe(90000n);
  });

  it("refuses a pattern with fewer values than the column needs", () => {
    const tooNarrow = () => makeIdGenerator({ mask: digits(2), repeat_structure: { "1": 150 } }, 1);
    expect(tooNarrow).toThrow(IdPatternError);
    try {
      tooNarrow();
    } catch (e) {
      expect((e as IdPatternError).allowed).toBe(100n);
      expect((e as IdPatternError).needed).toBe(150);
    }
  });

  it("copes with an empty structure", () => {
    const gen = makeIdGenerator({ mask: digits(3), repeat_structure: {} }, 1);
    expect(gen.groups).toBe(0);
  });

  it("puts a group's rows in different places (the rank is already shuffled)", () => {
    const gen = makeIdGenerator({ mask: digits(6), repeat_structure: { "2": 3 } }, 1);
    // Ranks 0 and 1 are the same group, 2 and 3 the next.
    expect(gen(0)).toBe(gen(1));
    expect(gen(2)).toBe(gen(3));
    expect(gen(0)).not.toBe(gen(2));
  });
});

describe("example IDs for the editor", () => {
  it("makes a few distinct IDs that fit", () => {
    const ids = sampleIds(site, 5);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(ids.every((id) => matchesMask(id, site))).toBe(true);
  });

  it("makes no more than the pattern allows, and nothing for an empty one", () => {
    expect(sampleIds(["digit"], 5)).toHaveLength(5);
    expect(sampleIds(["digit"], 50)).toHaveLength(10);
    expect(sampleIds([], 5)).toEqual([]);
  });

  it("respects a min, max and padding", () => {
    const ids = sampleIds(digits(5), 5, 100, 200, 5);
    expect(ids.every((id) => /^00\d{3}$/.test(id) && Number(id) >= 100 && Number(id) <= 200)).toBe(true);
  });
});
