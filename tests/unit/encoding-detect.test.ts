import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeText, detectEncoding, isValidUtf8 } from "../../src/lib/encoding/detect";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "../fixtures/zoo", name)));

describe("encoding detection on the fixture variants", () => {
  it("detects UTF-8 without a BOM", () => {
    const d = detectEncoding(fixture("variant_utf8.csv"));
    expect(d).toMatchObject({ encoding: "utf-8", bom: false, confidence: "high" });
  });

  it("detects UTF-8 with a BOM", () => {
    expect(detectEncoding(fixture("variant_utf8_bom.csv"))).toMatchObject({ encoding: "utf-8", bom: true });
  });

  it("detects UTF-16 little and big endian by BOM", () => {
    expect(detectEncoding(fixture("variant_utf16le.csv"))).toMatchObject({ encoding: "utf-16le", bom: true });
    expect(detectEncoding(fixture("variant_utf16be.csv"))).toMatchObject({ encoding: "utf-16be", bom: true });
  });

  it("falls back to Windows-1252 for single-byte accents", () => {
    expect(detectEncoding(fixture("variant_cp1252.csv"))).toMatchObject({
      encoding: "windows-1252",
      bom: false,
      confidence: "low",
    });
  });

  it("reports plain ASCII as UTF-8 with medium confidence", () => {
    expect(detectEncoding(new TextEncoder().encode("a,b\n1,2\n"))).toMatchObject({
      encoding: "utf-8",
      confidence: "medium",
    });
  });
});

describe("UTF-16 without a BOM", () => {
  it("is recognized from the zero-byte pattern", () => {
    const le = Buffer.from("id,name\n1,Ann\n2,Bob\n3,Cy\n", "utf16le");
    expect(detectEncoding(new Uint8Array(le)).encoding).toBe("utf-16le");
    const be = Buffer.from(le).swap16();
    expect(detectEncoding(new Uint8Array(be)).encoding).toBe("utf-16be");
  });
});

describe("UTF-32 and edge input", () => {
  it("flags a UTF-32 BOM as unsupported", () => {
    const d = detectEncoding(Uint8Array.from([0xff, 0xfe, 0x00, 0x00, 0x41, 0, 0, 0]));
    expect(d.unsupported).toBe(true);
  });

  it("handles empty input without throwing", () => {
    expect(detectEncoding(new Uint8Array(0)).encoding).toBe("utf-8");
  });
});

describe("UTF-8 validity", () => {
  it("accepts valid text and a character cut at the end of the sample", () => {
    const bytes = new TextEncoder().encode("abc東京");
    expect(isValidUtf8(bytes)).toBe(true);
    expect(isValidUtf8(bytes.subarray(0, bytes.length - 1))).toBe(true);
  });

  it("rejects invalid bytes in the middle", () => {
    expect(isValidUtf8(Uint8Array.from([0x61, 0xe9, 0x62, 0x63, 0x64]))).toBe(false);
  });
});

describe("decodeText", () => {
  it("decodes every variant to the same header and skips the BOM", () => {
    const header = "id,label,amount,when,flag,note";
    for (const [file, enc] of [
      ["variant_utf8.csv", "utf-8"],
      ["variant_utf8_bom.csv", "utf-8"],
      ["variant_utf16le.csv", "utf-16le"],
      ["variant_utf16be.csv", "utf-16be"],
      ["variant_cp1252.csv", "windows-1252"],
    ] as const) {
      const text = decodeText(fixture(file), enc);
      expect(text.split("\n")[0]).toBe(header);
    }
  });

  it("decodes the Euro sign and accents in Windows-1252", () => {
    const text = decodeText(fixture("variant_cp1252.csv"), "windows-1252");
    expect(text).toContain("€5");
    expect(text).toContain("Café");
  });
});
