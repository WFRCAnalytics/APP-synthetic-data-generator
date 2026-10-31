import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CsvFormatError,
  DEFAULT_DIALECT,
  eol,
  formatField,
  formatRow,
  stripFinalEol,
  type CsvDialect,
} from "../../src/lib/csv/writer";
import { parseCsv } from "../helpers/csvParse";

const d = (over: Partial<CsvDialect> = {}): CsvDialect => ({ ...DEFAULT_DIALECT, ...over });
const fixture = (name: string) => readFileSync(join(__dirname, "../fixtures/zoo", name), "utf8");

describe("minimal quoting", () => {
  it("leaves plain values alone", () => {
    expect(formatField("abc", d())).toBe("abc");
    expect(formatField("12.50", d())).toBe("12.50");
  });

  it("quotes delimiters, quotes, line breaks and edge spaces", () => {
    expect(formatField("a,b", d())).toBe('"a,b"');
    expect(formatField('say "hi"', d())).toBe('"say ""hi"""');
    expect(formatField("two\nlines", d())).toBe('"two\nlines"');
    expect(formatField("cr\rhere", d())).toBe('"cr\rhere"');
    expect(formatField(" lead", d())).toBe('" lead"');
    expect(formatField("trail ", d())).toBe('"trail "');
  });

  it("uses the file's own delimiter when deciding", () => {
    expect(formatField("a,b", d({ delimiter: ";" }))).toBe("a,b");
    expect(formatField("a;b", d({ delimiter: ";" }))).toBe('"a;b"');
  });

  it("writes an empty NA token as nothing", () => {
    expect(formatField("", d())).toBe("");
  });
});

describe("quote all", () => {
  it("quotes every field including empty ones", () => {
    expect(formatField("abc", d({ quoteStyle: "all" }))).toBe('"abc"');
    expect(formatField("", d({ quoteStyle: "all" }))).toBe('""');
  });
});

describe("per-column quoting", () => {
  it("quotes only the flagged columns, still quoting when required", () => {
    const dialect = d({ quoteStyle: "per_column" });
    expect(formatRow(["1", "text", "2.5", "a,b"], dialect, [false, true, false, false])).toBe('1,"text",2.5,"a,b"\n');
  });

  it("does not quote an empty field even in a quoted column", () => {
    expect(formatField("", d({ quoteStyle: "per_column" }), true)).toBe("");
  });
});

describe("files without a quote character", () => {
  it("never quotes plain values", () => {
    expect(formatField("abc", d({ quote: null }))).toBe("abc");
  });

  it("throws when a field cannot be represented", () => {
    expect(() => formatField("a,b", d({ quote: null }))).toThrow(CsvFormatError);
  });
});

describe("rows and line endings", () => {
  it("joins fields with the delimiter and ends with the line ending", () => {
    expect(formatRow(["a", "b", "c"], d({ delimiter: "|" }))).toBe("a|b|c\n");
  });

  it("supports LF, CRLF and CR", () => {
    expect(eol(d({ lineEnding: "lf" }))).toBe("\n");
    expect(eol(d({ lineEnding: "crlf" }))).toBe("\r\n");
    expect(eol(d({ lineEnding: "cr" }))).toBe("\r");
    expect(formatRow(["a"], d({ lineEnding: "crlf" }))).toBe("a\r\n");
  });

  it("strips only the final line ending", () => {
    expect(stripFinalEol("a\nb\n", d())).toBe("a\nb");
    expect(stripFinalEol("a\r\nb\r\n", d({ lineEnding: "crlf" }))).toBe("a\r\nb");
    expect(stripFinalEol("a\nb", d())).toBe("a\nb");
  });
});

// Parse each fixture with an independent parser, write it back with our writer, and expect the
// exact same text. This is the format-fidelity promise (Principle IV) at the file level.
describe("round trip against the fixture files", () => {
  const cases: [string, Partial<CsvDialect>][] = [
    ["variant_utf8.csv", {}],
    ["quote_all.csv", { quoteStyle: "all" }],
    ["delim_pipe.csv", { delimiter: "|" }],
    ["delim_tab.tsv", { delimiter: "\t" }],
    ["delim_semicolon_decimal_comma.csv", { delimiter: ";" }],
    ["eol_crlf.csv", { lineEnding: "crlf" }],
    ["eol_cr.csv", { lineEnding: "cr" }],
  ];

  it.each(cases)("rewrites %s byte for byte", (file, over) => {
    const text = fixture(file);
    const dialect = d(over);
    const { rows } = parseCsv(text, dialect.delimiter);
    const rewritten = rows.map((r) => formatRow(r, dialect)).join("");
    expect(rewritten).toBe(text);
  });

  it("rewrites the per-column quoted fixture using flags read from the first data row", () => {
    const text = fixture("quote_percolumn.csv");
    const { rows, quoted } = parseCsv(text);
    const flags = quoted[1]; // first data row
    expect(flags).toEqual([false, true, false, true, true, true]);
    const dialect = d({ quoteStyle: "per_column" });
    const header = formatRow(rows[0], dialect, rows[0].map(() => true));
    const body = rows.slice(1).map((r) => formatRow(r, dialect, flags)).join("");
    expect(header + body).toBe(text);
  });

  it("rewrites the no-trailing-newline fixture with the final line ending removed", () => {
    const text = fixture("no_trailing_newline.csv");
    const { rows } = parseCsv(text);
    const rewritten = stripFinalEol(rows.map((r) => formatRow(r, d())).join(""), d());
    expect(rewritten).toBe(text);
  });
});

describe("free text with line breaks (specs/002 FR-006)", () => {
  const text = "first line\nsecond line, with a comma";

  it.each(["minimal", "all", "per_column"] as const)("keeps a value with a line break whole and parseable under %s quoting", (quoteStyle) => {
    const dialect = d({ quoteStyle });
    const row = formatRow(["id", text, "tail"], dialect, [false, false, false]);
    const parsed = parseCsv(row);
    expect(parsed.rows).toEqual([["id", text, "tail"]]);
  });

  it("quotes it even when the real column's other values were not quoted", () => {
    expect(formatField(text, d({ quoteStyle: "per_column" }), false).startsWith('"')).toBe(true);
  });

  it("round trips a carriage return and line feed pair inside a value", () => {
    const value = "a\r\nb";
    expect(parseCsv(formatRow([value, "x"], d())).rows).toEqual([[value, "x"]]);
  });
});
