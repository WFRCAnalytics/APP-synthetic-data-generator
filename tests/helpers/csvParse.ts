// A small, strict CSV parser used only by tests, so round-trip checks do not depend on the
// code under test. It records which fields were quoted, to verify per-column quoting.

export interface ParsedCsv {
  rows: string[][];
  quoted: boolean[][];
}

export function parseCsv(text: string, delimiter = ",", quote = '"'): ParsedCsv {
  const rows: string[][] = [];
  const quoted: boolean[][] = [];
  let row: string[] = [];
  let flags: boolean[] = [];
  let field = "";
  let wasQuoted = false;
  let inQuotes = false;
  let sawAny = false;

  const endField = () => {
    row.push(field);
    flags.push(wasQuoted);
    field = "";
    wasQuoted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    quoted.push(flags);
    row = [];
    flags = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    sawAny = true;
    if (inQuotes) {
      if (ch === quote) {
        if (text[i + 1] === quote) {
          field += quote;
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === quote && field === "") {
      inQuotes = true;
      wasQuoted = true;
    } else if (ch === delimiter) endField();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") endRow();
    else field += ch;
  }
  if (sawAny && (field !== "" || wasQuoted || row.length > 0)) endRow();
  return { rows, quoted };
}
