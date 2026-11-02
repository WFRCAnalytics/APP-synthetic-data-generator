import { describe, expect, it } from "vitest";
import { detectJson } from "../../src/lib/json/detect";

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const detect = (s: string) => detectJson(bytes(s), bytes(s.slice(-64)));

describe("detectJson", () => {
  it("tells an array from one record per line by the first character, never by a name", () => {
    expect(detect('[{"a":1}]').form).toBe("array");
    expect(detect('{"a":1}\n{"a":2}\n').form).toBe("lines");
    expect(detect('  \n\t[ {"a":1} ]').form).toBe("array");
    expect(detect("id,name\n1,2\n").form).toBeNull();
    expect(detect("").form).toBeNull();
    expect(detect("   ").form).toBeNull();
    expect(detect("42").form).toBeNull();
  });

  it("sees a byte-order mark", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('[{"a":1}]')]);
    const r = detectJson(withBom, withBom);
    expect(r.layout.bom).toBe(true);
    expect(r.form).toBe("array");
    expect(detect('[{"a":1}]').layout.bom).toBe(false);
  });

  it("reads the line ending from the first line break", () => {
    expect(detect('[\n  {"a":1}\n]\n').layout.lineEnding).toBe("lf");
    expect(detect('[\r\n  {"a":1}\r\n]\r\n').layout.lineEnding).toBe("crlf");
    expect(detect('[{"a":1}]').layout.lineEnding).toBe("lf");
  });

  it("sees whether the file ends with a line break", () => {
    expect(detect('[{"a":1}]\n').layout.trailingNewline).toBe(true);
    expect(detect('[{"a":1}]').layout.trailingNewline).toBe(false);
    expect(detect('{"a":1}\r\n').layout.trailingNewline).toBe(true);
  });

  it("reads the indent of an array: 2, 4, tab, or compact", () => {
    expect(detect('[\n  {\n    "a": 1\n  }\n]').layout.indent).toBe("2");
    expect(detect('[\n    {\n        "a": 1\n    }\n]').layout.indent).toBe("4");
    expect(detect('[\n\t{\n\t\t"a": 1\n\t}\n]').layout.indent).toBe("tab");
    expect(detect('[{"a": 1}, {"a": 2}]').layout.indent).toBe("compact");
    expect(detect('[\n   {\n      "a": 1\n   }\n]').layout.indent).toBe("compact"); // three spaces: not one of the recorded layouts
  });

  it("gives a lines file no indent", () => {
    expect(detect('{"a":1}\n{"a":2}\n').layout.indent).toBe("compact");
  });

  it("looks only at the bytes handed to it", () => {
    const head = bytes('[\n  {"a":"SECRET"}');
    const tail = bytes("]\n");
    expect(JSON.stringify(detectJson(head, tail))).not.toContain("SECRET");
  });
});
