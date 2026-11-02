import { describe, expect, it } from "vitest";
import { describeKey } from "../../src/lib/json/kinds";

const counts = (types: Record<string, number>, records: number) => describeKey({ types, records });

describe("describeKey", () => {
  it("calls a key of numbers a number, whatever width or whether it has decimals", () => {
    expect(counts({ UBIGINT: 3 }, 3).kind).toBe("number");
    expect(counts({ UBIGINT: 2, DOUBLE: 1, BIGINT: 1 }, 4)).toMatchObject({ kind: "number", mixed: false });
  });

  it("calls a key of text a string, and a key of true or false a boolean", () => {
    expect(counts({ VARCHAR: 5 }, 5).kind).toBe("string");
    expect(counts({ BOOLEAN: 5 }, 5).kind).toBe("boolean");
  });

  it("counts nulls and missing records apart", () => {
    const d = counts({ UBIGINT: 6, NULL: 2 }, 10);
    expect(d).toMatchObject({ kind: "number", nulls: 2, missing: 2 });
  });

  it("reads a key that was always null as null, and a key never present as missing everywhere", () => {
    expect(counts({ NULL: 4 }, 4)).toMatchObject({ kind: "null", nulls: 4, missing: 0 });
    expect(counts({}, 4)).toMatchObject({ kind: "null", nulls: 0, missing: 4 });
  });

  it("reads numbers and text mixed as text, with the mixed flag", () => {
    expect(counts({ UBIGINT: 2, VARCHAR: 2 }, 4)).toMatchObject({ kind: "string", mixed: true });
    expect(counts({ BOOLEAN: 1, UBIGINT: 3 }, 4)).toMatchObject({ kind: "string", mixed: true });
  });

  it("marks a key that ever holds an object or a list as that nested kind", () => {
    expect(counts({ OBJECT: 1, VARCHAR: 3 }, 4).kind).toBe("object");
    expect(counts({ ARRAY: 4 }, 4).kind).toBe("array");
    expect(counts({ OBJECT: 1, ARRAY: 1 }, 2).kind).toBe("object");
  });

  it("never reports a negative missing count", () => {
    expect(counts({ VARCHAR: 5 }, 3).missing).toBe(0);
  });
});

import { fitKind } from "../../src/lib/json/kinds";

describe("fitKind", () => {
  it("keeps a kind that suits the type", () => {
    expect(fitKind("number", "integer")).toBe("number");
    expect(fitKind("number", "categorical")).toBe("number");
    expect(fitKind("boolean", "boolean")).toBe("boolean");
    expect(fitKind("string", "date")).toBe("string");
  });

  it("writes as text a key whose chosen type cannot hold its kind", () => {
    expect(fitKind("number", "date")).toBe("string");
    expect(fitKind("number", "personal")).toBe("string");
    expect(fitKind("boolean", "integer")).toBe("string");
    expect(fitKind("null", "categorical")).toBe("string");
  });

  it("writes an empty column as null, and keeps nested kinds on unsupported columns", () => {
    expect(fitKind("string", "empty")).toBe("null");
    expect(fitKind("array", "unsupported")).toBe("array");
    expect(fitKind("number", "unsupported")).toBe("object");
  });
});
