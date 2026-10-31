import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeText, detectEncoding } from "../../src/lib/encoding/detect";
import { hasTrailingNewline, sniffDialect, splitRecords, uniqueNames } from "../../src/lib/csv/sniff";

function sniffFixture(name: string) {
  const bytes = new Uint8Array(readFileSync(join(__dirname, "../fixtures/zoo", name)));
  const detected = detectEncoding(bytes);
  const text = decodeText(bytes, detected.encoding);
  return { sniff: sniffDialect(text, false), bytes, detected };
}

describe("delimiter detection", () => {
  it.each([
    ["variant_utf8.csv", ","],
    ["delim_semicolon_decimal_comma.csv", ";"],
    ["delim_tab.tsv", "\t"],
    ["delim_pipe.csv", "|"],
  ])("finds the delimiter in %s", (file, delimiter) => {
    const { sniff } = sniffFixture(file);
    expect(sniff.delimiter).toBe(delimiter);
    expect(sniff.columnCount).toBe(6);
    expect(sniff.consistent).toBe(true);
  });

  it("falls back to a comma for a single-column file", () => {
    const { sniff } = sniffFixture("single_column.csv");
    expect(sniff.delimiter).toBe(",");
    expect(sniff.columnCount).toBe(1);
  });
});

describe("header detection", () => {
  it("detects a header row", () => {
    const { sniff } = sniffFixture("variant_utf8.csv");
    expect(sniff.header).toBe(true);
    expect(sniff.columnNames).toEqual(["id", "label", "amount", "when", "flag", "note"]);
  });

  it("detects a file with no header and names the columns", () => {
    const { sniff } = sniffFixture("no_header.csv");
    expect(sniff.header).toBe(false);
    expect(sniff.columnNames).toEqual(["column_1", "column_2", "column_3", "column_4", "column_5", "column_6"]);
  });

  it("treats a header-only file as having a header", () => {
    const { sniff } = sniffFixture("header_only.csv");
    expect(sniff.header).toBe(true);
    expect(sniff.columnNames).toEqual(["id", "label", "amount"]);
  });

  it("handles the 500-column file", () => {
    const { sniff } = sniffFixture("wide_500.csv");
    expect(sniff.columnCount).toBe(500);
    expect(sniff.header).toBe(true);
  });
});

describe("column names", () => {
  it("makes duplicates and blanks unique", () => {
    expect(uniqueNames(["a", "a", "b"])).toEqual(["a", "a_1", "b"]);
    expect(uniqueNames(["a", "", "b"])).toEqual(["a", "column_2", "b"]);
    expect(uniqueNames(["a", "a", "a_1"])).toEqual(["a", "a_1", "a_1_1"]);
  });

  it("applies to the duplicate and blank fixtures", () => {
    expect(sniffFixture("dup_columns.csv").sniff.columnNames).toEqual(["a", "a_1", "b"]);
    expect(sniffFixture("blank_col_name.csv").sniff.columnNames).toEqual(["a", "column_2", "b"]);
  });
});

describe("line endings and trailing newline", () => {
  it.each([
    ["variant_utf8.csv", "lf"],
    ["eol_crlf.csv", "crlf"],
    ["eol_cr.csv", "cr"],
  ])("detects %s", (file, eol) => {
    expect(sniffFixture(file).sniff.lineEnding).toBe(eol);
  });

  it("detects a missing trailing newline from the last bytes", () => {
    const withNl = sniffFixture("variant_utf8.csv");
    const without = sniffFixture("no_trailing_newline.csv");
    expect(hasTrailingNewline(withNl.bytes.subarray(-8), "utf-8")).toBe(true);
    expect(hasTrailingNewline(without.bytes.subarray(-8), "utf-8")).toBe(false);
  });

  it("looks at the right bytes for UTF-16", () => {
    expect(hasTrailingNewline(Uint8Array.from([0x41, 0, 0x0a, 0]), "utf-16le")).toBe(true);
    expect(hasTrailingNewline(Uint8Array.from([0, 0x41, 0, 0x0a]), "utf-16be")).toBe(true);
    expect(hasTrailingNewline(Uint8Array.from([0x41, 0, 0x42, 0]), "utf-16le")).toBe(false);
  });
});

describe("quote style", () => {
  it("detects minimal quoting (quotes only where needed)", () => {
    const { sniff } = sniffFixture("variant_utf8.csv");
    expect(sniff.quoteStyle).toBe("minimal");
    expect(sniff.headerQuoted).toBe(false);
  });

  it("detects quote-everything files", () => {
    const { sniff } = sniffFixture("quote_all.csv");
    expect(sniff.quoteStyle).toBe("all");
    expect(sniff.headerQuoted).toBe(true);
  });

  it("detects per-column quoting and which columns are quoted", () => {
    const { sniff } = sniffFixture("quote_percolumn.csv");
    expect(sniff.quoteStyle).toBe("per_column");
    expect(sniff.quoted).toEqual([false, true, false, true, true, true]);
    expect(sniff.headerQuoted).toBe(true);
  });
});

describe("malformed files", () => {
  it("reports ragged rows as inconsistent", () => {
    expect(sniffFixture("ragged.csv").sniff.consistent).toBe(false);
  });

  it("copes with an empty file", () => {
    const { sniff } = sniffFixture("empty.csv");
    expect(sniff.columnCount).toBe(0);
    expect(sniff.recordsSampled).toBe(0);
  });
});

describe("record splitting", () => {
  it("handles quoted delimiters, doubled quotes and embedded line breaks", () => {
    const { rows, quoted } = splitRecords('a,b\n"x,y","say ""hi"""\n"two\nlines",z\n', ",", '"', false);
    expect(rows).toEqual([
      ["a", "b"],
      ["x,y", 'say "hi"'],
      ["two\nlines", "z"],
    ]);
    expect(quoted[1]).toEqual([true, true]);
  });

  it("drops an incomplete last record only when the sample is truncated", () => {
    expect(splitRecords("a,b\n1,2\n3", ",", '"', true).rows).toEqual([["a", "b"], ["1", "2"]]);
    expect(splitRecords("a,b\n1,2\n3,4", ",", '"', false).rows).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  it("ignores an unterminated quoted field at the end of a complete file", () => {
    expect(splitRecords('a\n"open', ",", '"', false).rows).toEqual([["a"]]);
  });
});
