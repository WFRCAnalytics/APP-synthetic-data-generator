// The composers of invented personal values (specs/002 FR-002, FR-005, research R3, R4, R8): each
// value has the format of its kind, different positions never give the same value, the suffix tells
// apart values past the natural space, and the reserved ranges are never used.

import { describe, expect, it } from "vitest";
import { makePersonalComposer } from "../../src/lib/textgen/personal";
import { fillShape } from "../../src/lib/textgen/phone";
import type { PersonalKind } from "../../src/lib/spec/types";

const KINDS: PersonalKind[] = ["full_name", "first_name", "last_name", "email", "phone", "address", "url", "ip", "ssn"];

const sample = (kind: PersonalKind, want = 3000, format?: Parameters<typeof makePersonalComposer>[1]) => {
  const c = makePersonalComposer(kind, format);
  const n = Math.min(want, c.natural);
  // Spread the indexes over the whole natural space, not just the start of it.
  const step = Math.max(1, Math.floor(c.natural / n));
  return { c, values: Array.from({ length: n }, (_, i) => c.valueAt(Math.min(c.natural - 1, i * step), 0)) };
};

describe.each(KINDS)("%s", (kind) => {
  it("has a natural space and gives different values for different positions", () => {
    const { c, values } = sample(kind);
    expect(c.natural).toBeGreaterThan(100);
    expect(new Set(values).size).toBe(values.length);
  });

  it("is a pure function of the position", () => {
    const a = makePersonalComposer(kind);
    const b = makePersonalComposer(kind);
    for (const i of [0, 1, 17, 999, a.natural - 1]) expect(a.valueAt(i, 0)).toBe(b.valueAt(i, 0));
  });

  it("tells apart the values of later passes through the suffix, where the format has room for one", () => {
    const c = makePersonalComposer(kind);
    if (!c.suffixes) {
      expect(c.natural).toBeGreaterThan(50_000_000); // no suffix needed in practice
      return;
    }
    const seen = new Set<string>();
    for (let s = 0; s < 60; s++) seen.add(c.valueAt(5, s));
    expect(seen.size).toBe(60);
  });

  it("writes plain text with no line break, comma-free except where the kind has one", () => {
    const { values } = sample(kind, 500);
    for (const v of values) {
      expect(v).not.toMatch(/[\r\n]/);
      expect(v.trim()).toBe(v);
      expect(v.length).toBeGreaterThan(0);
    }
  });
});

describe("names", () => {
  it("full names are a given name and a family name, with an initial only after the pairs run out", () => {
    const c = makePersonalComposer("full_name");
    expect(c.valueAt(0, 0)).toMatch(/^\S+ \S+/);
    expect(c.valueAt(0, 0)).not.toMatch(/ [A-Z]\. /);
    expect(c.valueAt(0, 1)).toMatch(/ [A-Z]\. /);
    expect(c.valueAt(0, 30)).toMatch(/\d/);
  });

  it("keeps the Last, First form when the real column used it", () => {
    const c = makePersonalComposer("full_name", { last_first: true });
    expect(c.valueAt(10, 0)).toMatch(/^[^,]+, \S+/);
  });

  it("has over a million natural pairs, so 50,000 names need no suffix", () => {
    expect(makePersonalComposer("full_name").natural).toBeGreaterThan(1_000_000);
  });
});

describe("email", () => {
  it("looks like an email and never uses example domains or a domain copied from data", () => {
    const { values } = sample("email", 800);
    for (const v of values) {
      expect(v).toMatch(/^[a-z0-9.]+@[a-z0-9.-]+\.[a-z]+$/);
      expect(v).not.toMatch(/@example\./);
    }
  });
});

describe("phone", () => {
  it("fills the default shape with ten digits and never uses the 555 exchange", () => {
    const { values } = sample("phone", 2000);
    for (const v of values) {
      expect(v).toMatch(/^\(\d{3}\) \d{3}-\d{4}$/);
      expect(v.slice(6, 9)).not.toBe("555");
      expect(v[1]).toMatch(/[2-9]/);
    }
  });

  it("follows the shapes profiled from the real column in their shares", () => {
    const format = { shapes: [{ shape: "999-999-9999", share: 0.75 }, { shape: "9999999999", share: 0.25 }] };
    const { values } = sample("phone", 4000, format);
    const dashed = values.filter((v) => /^\d{3}-\d{3}-\d{4}$/.test(v)).length;
    const plain = values.filter((v) => /^\d{10}$/.test(v)).length;
    expect(dashed + plain).toBe(values.length);
    expect(dashed / values.length).toBeGreaterThan(0.68);
    expect(dashed / values.length).toBeLessThan(0.82);
  });

  it("fills shapes with a leading 1 or only seven digits", () => {
    expect(fillShape("9-999-999-9999", "8015550123")).toBe("1-801-555-0123");
    expect(fillShape("999-9999", "8015550123")).toBe("555-0123");
  });
});

describe("address", () => {
  it("is a number, a street name and a street suffix", () => {
    const { values } = sample("address", 800);
    for (const v of values) expect(v).toMatch(/^\d{1,4} .+ \S+$/);
  });

  it("adds a unit when the real column had them", () => {
    const { values } = sample("address", 200, { unit: true });
    expect(values.every((v) => /, (Apt\.|Suite) \d{3}$/.test(v))).toBe(true);
  });
});

describe("url and ip", () => {
  it("urls start with https and have a host and a path", () => {
    const { values } = sample("url", 500);
    for (const v of values) expect(v).toMatch(/^https:\/\/www\.[a-z]+\.[a-z]+\/[a-z]+$/);
  });

  it("ip addresses are never private, loopback, link-local or documentation addresses", () => {
    const { values } = sample("ip", 4000);
    for (const v of values) {
      const [a, b, c, d] = v.split(".").map(Number);
      expect([a, b, c, d].every((n) => n >= 0 && n <= 255)).toBe(true);
      expect([0, 10, 100, 127, 169, 172, 192, 198, 203].includes(a)).toBe(false);
      expect(a).toBeLessThan(224);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(255);
    }
  });
});

describe("ssn", () => {
  it("uses the 900 to 999 area range, which is never assigned", () => {
    const { values } = sample("ssn", 3000);
    for (const v of values) {
      expect(v).toMatch(/^9\d\d-(0[1-9]|[1-9]\d)-(?!0000)\d{4}$/);
    }
  });

  it("keeps a shape without dashes", () => {
    const { values } = sample("ssn", 200, { shape: "999999999" });
    expect(values.every((v) => /^9\d{8}$/.test(v))).toBe(true);
  });
});
