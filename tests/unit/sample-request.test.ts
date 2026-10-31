// Live samples for the Review cards (specs/002 FR-010, research R10): invented values only, never more
// than ten, deterministic for a seed, and fitting the description they were asked for.

import { describe, expect, it } from "vitest";
import { MAX_SAMPLES, sampleValues } from "../../src/lib/textgen/sample";

describe("personal samples", () => {
  it("returns the number asked for, all different, up to ten", () => {
    const v = sampleValues({ kind: "personal", personalKind: "email" }, 5, 1);
    expect(v).toHaveLength(5);
    expect(new Set(v).size).toBe(5);
    expect(sampleValues({ kind: "personal", personalKind: "email" }, 50, 1)).toHaveLength(MAX_SAMPLES);
    expect(sampleValues({ kind: "personal", personalKind: "email" }, 0, 1)).toEqual([]);
  });

  it("fits the kind and follows the format", () => {
    for (const v of sampleValues({ kind: "personal", personalKind: "email" }, 10, 3)) expect(v).toMatch(/^[a-z0-9.]+@[a-z0-9.-]+\.[a-z]+$/);
    for (const v of sampleValues({ kind: "personal", personalKind: "phone", format: { shapes: [{ shape: "999-999-9999", share: 1 }] } }, 10, 3)) expect(v).toMatch(/^\d{3}-\d{3}-\d{4}$/);
    for (const v of sampleValues({ kind: "personal", personalKind: "full_name", format: { last_first: true } }, 10, 3)) expect(v).toContain(", ");
  });

  it("is deterministic for a seed and varies with it", () => {
    const a = sampleValues({ kind: "personal", personalKind: "full_name" }, 10, 7);
    expect(sampleValues({ kind: "personal", personalKind: "full_name" }, 10, 7)).toEqual(a);
    expect(sampleValues({ kind: "personal", personalKind: "full_name" }, 10, 8)).not.toEqual(a);
  });
});

describe("free text samples", () => {
  it("spans the length range and stays inside it", () => {
    const v = sampleValues({ kind: "free_text", min: 5, max: 300 }, 5, 1);
    const lengths = v.map((s) => s.length);
    expect(Math.min(...lengths)).toBe(5);
    expect(Math.max(...lengths)).toBe(300);
    expect(lengths.every((l) => l >= 5 && l <= 300)).toBe(true);
  });
});

describe("short string samples", () => {
  it("fits the pattern and covers the lengths", () => {
    const pattern = ["upper", "upper", { literal: "-" }, "digit", "digit", "digit", "digit"] as const;
    const v = sampleValues({ kind: "short_string", pattern: [...pattern], lengthGroups: { "7": 1000, "6": 50 } }, 6, 2);
    expect(v.length).toBeGreaterThan(0);
    for (const s of v) expect(s).toMatch(/^[A-Z]{2}-\d{1,4}$/);
    expect(new Set(v.map((s) => s.length)).size).toBe(2);
  });

  it("returns nothing for an empty pattern", () => {
    expect(sampleValues({ kind: "short_string", pattern: [], lengthGroups: { "3": 5 } }, 5, 1)).toEqual([]);
  });

  it("makes fewer values when the pattern has little room", () => {
    const v = sampleValues({ kind: "short_string", pattern: ["digit"], lengthGroups: { "1": 100 } }, 10, 1);
    expect(v).toHaveLength(10);
    expect(new Set(v).size).toBe(10);
  });
});
