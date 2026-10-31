// CSV field and row formatting that reproduces the source file's dialect (FR-028): delimiter, quote
// character, quote style (including per-column quoting, where text is quoted and numbers are not),
// line endings and trailing newline. Pure functions; encoding is applied afterwards (encoders.ts).

export type LineEnding = "lf" | "crlf" | "cr";
export type QuoteStyle = "minimal" | "all" | "per_column";

export interface CsvDialect {
  delimiter: string;
  /** The quote character, or null for files that never quote. */
  quote: string | null;
  quoteStyle: QuoteStyle;
  lineEnding: LineEnding;
  header: boolean;
  trailingNewline: boolean;
}

export const DEFAULT_DIALECT: CsvDialect = {
  delimiter: ",",
  quote: '"',
  quoteStyle: "minimal",
  lineEnding: "lf",
  header: true,
  trailingNewline: true,
};

export class CsvFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvFormatError";
  }
}

export function eol(dialect: CsvDialect): string {
  return dialect.lineEnding === "crlf" ? "\r\n" : dialect.lineEnding === "cr" ? "\r" : "\n";
}

// "Minimal" quotes only when a parser would otherwise misread the field: the delimiter, the quote
// character or a line break inside it, or leading/trailing spaces that some parsers trim.
function needsQuoting(value: string, dialect: CsvDialect): boolean {
  return (
    value.includes(dialect.delimiter) ||
    (dialect.quote !== null && value.includes(dialect.quote)) ||
    value.includes("\n") ||
    value.includes("\r") ||
    /^[ \t]|[ \t]$/.test(value)
  );
}

/** Formats one field. `quoted` is the column's source flag, used only by the per_column style. */
export function formatField(value: string, dialect: CsvDialect, quoted = false): string {
  const quote = dialect.quote;
  if (value === "") {
    // An empty NA token stays empty, except in files that quote every field.
    return dialect.quoteStyle === "all" && quote !== null ? quote + quote : "";
  }

  const mustQuote = needsQuoting(value, dialect);
  if (mustQuote && quote === null) {
    throw new CsvFormatError("a field needs quoting but the file has no quote character");
  }
  const wantQuote =
    quote !== null &&
    (mustQuote || dialect.quoteStyle === "all" || (dialect.quoteStyle === "per_column" && quoted));

  if (!wantQuote || quote === null) return value;
  return quote + value.split(quote).join(quote + quote) + quote;
}

/** Formats one row including its line ending. */
export function formatRow(values: readonly string[], dialect: CsvDialect, quotedFlags?: readonly boolean[]): string {
  let out = "";
  for (let c = 0; c < values.length; c++) {
    if (c > 0) out += dialect.delimiter;
    out += formatField(values[c], dialect, quotedFlags?.[c] ?? false);
  }
  return out + eol(dialect);
}

/** Removes the final line ending from the last chunk of a file whose source had none. */
export function stripFinalEol(text: string, dialect: CsvDialect): string {
  const end = eol(dialect);
  return text.endsWith(end) ? text.slice(0, text.length - end.length) : text;
}
