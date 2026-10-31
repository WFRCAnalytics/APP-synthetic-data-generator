import { describe, expect, it } from "vitest";
import { bomFor, encodeText } from "../../src/lib/csv/encoders";
import { decodeText } from "../../src/lib/encoding/detect";

describe("BOMs", () => {
  it("returns the right bytes per encoding", () => {
    expect([...bomFor("utf-8")]).toEqual([0xef, 0xbb, 0xbf]);
    expect([...bomFor("utf-16le")]).toEqual([0xff, 0xfe]);
    expect([...bomFor("utf-16be")]).toEqual([0xfe, 0xff]);
    expect(bomFor("windows-1252").length).toBe(0);
  });
});

describe("UTF-8", () => {
  it("encodes multi-byte text without replacements", () => {
    const { bytes, replaced } = encodeText("Café 東京", "utf-8");
    expect(replaced).toBe(0);
    expect(new TextDecoder().decode(bytes)).toBe("Café 東京");
  });
});

describe("UTF-16", () => {
  it("writes little and big endian byte orders", () => {
    expect([...encodeText("A", "utf-16le").bytes]).toEqual([0x41, 0x00]);
    expect([...encodeText("A", "utf-16be").bytes]).toEqual([0x00, 0x41]);
  });

  it("round trips text including characters outside the BMP", () => {
    const text = "id,name\n1,Zürich 東京 😀\n";
    for (const enc of ["utf-16le", "utf-16be"] as const) {
      const { bytes } = encodeText(text, enc);
      expect(decodeText(bytes, enc)).toBe(text);
    }
  });
});

describe("Windows-1252", () => {
  it("encodes Latin-1 accents as single bytes", () => {
    expect([...encodeText("Café", "windows-1252").bytes]).toEqual([0x43, 0x61, 0x66, 0xe9]);
  });

  it("puts the Euro sign and curly quotes in the 0x80 block", () => {
    expect([...encodeText("€", "windows-1252").bytes]).toEqual([0x80]);
    expect([...encodeText("“x”", "windows-1252").bytes]).toEqual([0x93, 0x78, 0x94]);
  });

  it("replaces unrepresentable characters with ? and counts them", () => {
    const { bytes, replaced } = encodeText("a東京b", "windows-1252");
    expect(replaced).toBe(2);
    expect(new TextDecoder("windows-1252").decode(bytes)).toBe("a??b");
  });

  it("round trips every representable character", () => {
    const text = "Straße señor naïve Ångström €5 – “quoted”";
    const { bytes, replaced } = encodeText(text, "windows-1252");
    expect(replaced).toBe(0);
    expect(new TextDecoder("windows-1252").decode(bytes)).toBe(text);
  });
});
