import { describe, expect, it } from "vitest";
import { createJsonConverter, jsonNumber, jsonString } from "../../src/lib/json/convert";
import { EMPTY_TEXT_TOKEN } from "../../src/lib/spec/types";

describe("jsonString", () => {
  it("escapes only what JSON requires, and keeps other characters as they are", () => {
    expect(jsonString('say "hi"')).toBe('"say \\"hi\\""');
    expect(jsonString("a\\b")).toBe('"a\\\\b"');
    expect(jsonString("line\nbreak\ttab\r")).toBe('"line\\nbreak\\ttab\\r"');
    expect(jsonString("bell\u0007")).toBe('"bell\\u0007"');
    expect(jsonString("café 😀")).toBe('"café 😀"');
  });

  it("escapes a lone surrogate, which UTF-8 cannot hold", () => {
    expect(jsonString("a\ud83db")).toBe('"a\\ud83db"');
  });

  it("round-trips through JSON.parse", () => {
    const text = 'x"\\\n\u0001é😀';
    expect(JSON.parse(jsonString(text))).toBe(text);
  });
});

describe("jsonNumber", () => {
  it("keeps valid JSON numbers as they are", () => {
    for (const t of ["0", "-1", "12.50", "1e5", "-2.5E-3", "123456789012345678901234567890"]) expect(jsonNumber(t)).toBe(t);
  });

  it("repairs a number written another way, and refuses what is not a finite number", () => {
    expect(jsonNumber("+5")).toBe("5");
    expect(jsonNumber(".5")).toBe("0.5");
    expect(jsonNumber(" 7 ")).toBe("7");
    for (const t of ["", "abc", "NaN", "Infinity", "1,000", "0x10"]) expect(jsonNumber(t)).toBeNull();
  });
});

describe("createJsonConverter", () => {
  it("writes numbers as numbers and counts text that is not one", () => {
    const c = createJsonConverter("number");
    expect(c.token("12.5")).toBe("12.5");
    expect(c.token("abc")).toBe("null");
    expect(c.stats.unparsed).toBe(1);
  });

  it("writes booleans as true or false", () => {
    const c = createJsonConverter("boolean");
    expect(c.token("true")).toBe("true");
    expect(c.token("FALSE")).toBe("false");
    expect(c.token("1")).toBe("true");
    expect(c.token("maybe")).toBe("null");
    expect(c.stats.unparsed).toBe(1);
  });

  it("writes strings quoted, and the empty-text token as an empty string", () => {
    const c = createJsonConverter("string");
    expect(c.token("12")).toBe('"12"');
    expect(c.token(EMPTY_TEXT_TOKEN)).toBe('""');
  });

  it("writes null for a key that holds nothing, and for nested kinds", () => {
    for (const kind of ["null", "object", "array"] as const) expect(createJsonConverter(kind).token("anything")).toBe("null");
  });

  it("never yields NaN or Infinity", () => {
    const c = createJsonConverter("number");
    for (const t of ["NaN", "Infinity", "-Infinity", "1e999"]) expect(c.token(t)).not.toMatch(/NaN|Infinity/);
  });
});
