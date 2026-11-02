// A codebook says what the codes of a coded column mean ("1 is Car"). It is documentation the person already has, not a
// part of the data; the app reads it in the page, keeps the labels beside the columns it matches, and shows them on Review
// and in the README for agents. The fake file still holds the codes, so code written against it runs on the real file.

import type { ColumnProfile } from "../profile/types";

export interface CodebookEntry {
  column: string;
  value: string;
  label: string;
}

export interface CodebookParse {
  entries: CodebookEntry[];
  /** Plain notes about what could not be read; they never quote the file. */
  problems: string[];
}

export const MAX_LABEL_LENGTH = 100;
export const MAX_ENTRIES = 20_000;
export const MAX_CODEBOOK_BYTES = 5 * 1024 * 1024;

const COLUMN_NAMES = ["column", "variable", "var", "name", "field", "variable name"];
const VALUE_NAMES = ["value", "code", "key", "category", "level"];
const LABEL_NAMES = ["label", "description", "meaning", "text", "value label", "name"];

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function clean(entry: CodebookEntry, problems: string[], seen: Set<string>): CodebookEntry | null {
  const column = entry.column.trim();
  const value = entry.value.trim();
  const label = entry.label.trim();
  if (column === "" || value === "" || label === "") return null;
  if (CONTROL.test(column) || CONTROL.test(value) || CONTROL.test(label)) {
    if (!seen.has("control"))
      problems.push("Some entries hold control characters and were skipped.");
    seen.add("control");
    return null;
  }
  if (label.length > MAX_LABEL_LENGTH) {
    if (!seen.has("long"))
      problems.push(`Some labels are longer than ${MAX_LABEL_LENGTH} characters and were skipped.`);
    seen.add("long");
    return null;
  }
  return { column, value, label };
}

/** Splits delimited text into rows, honouring double quotes. */
function splitRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

function pickIndex(header: string[], names: string[], not: number[] = []): number {
  for (const wanted of names) {
    const i = header.findIndex((h, at) => !not.includes(at) && h.trim().toLowerCase() === wanted);
    if (i >= 0) return i;
  }
  return -1;
}

function parseDelimited(text: string): CodebookParse {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", "\t", ";", "|"]
    .map((d) => ({ d, n: first.split(d).length }))
    .sort((a, b) => b.n - a.n)[0].d;
  const rows = splitRows(text, delimiter);
  const problems: string[] = [];
  if (rows.length < 2)
    return {
      entries: [],
      problems: [
        "The codebook has no rows. It needs a header row with column, value and label, then one row per code.",
      ],
    };
  const header = rows[0];
  const c = pickIndex(header, COLUMN_NAMES);
  const v = pickIndex(header, VALUE_NAMES, [c]);
  const l = pickIndex(header, LABEL_NAMES, [c, v]);
  if (c < 0 || v < 0 || l < 0)
    return {
      entries: [],
      problems: [
        "The first row must name three columns: the column (or variable), the value (or code) and the label (or description).",
      ],
    };
  const seen = new Set<string>();
  const entries: CodebookEntry[] = [];
  for (const row of rows.slice(1)) {
    const e = clean(
      { column: row[c] ?? "", value: row[v] ?? "", label: row[l] ?? "" },
      problems,
      seen,
    );
    if (e) entries.push(e);
  }
  return { entries, problems };
}

function parseJson(text: string): CodebookParse {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { entries: [], problems: ["The codebook is not valid JSON."] };
  }
  const problems: string[] = [];
  const seen = new Set<string>();
  const entries: CodebookEntry[] = [];
  const push = (column: unknown, value: unknown, label: unknown) => {
    if (typeof label === "object" && label !== null) return;
    const e = clean(
      { column: String(column), value: String(value), label: String(label) },
      problems,
      seen,
    );
    if (e) entries.push(e);
  };
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item === null || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const get = (names: string[]) => Object.keys(o).find((k) => names.includes(k.toLowerCase()));
      const c = get(COLUMN_NAMES);
      const v = get(VALUE_NAMES);
      const l = get(LABEL_NAMES.filter((n) => n !== "name"));
      if (c && v && l) push(o[c], o[v], o[l]);
    }
  } else if (data !== null && typeof data === "object") {
    for (const [column, codes] of Object.entries(data as Record<string, unknown>)) {
      if (codes === null || typeof codes !== "object" || Array.isArray(codes)) continue;
      for (const [value, label] of Object.entries(codes as Record<string, unknown>))
        push(column, value, label);
    }
  } else problems.push("The codebook must be a list of rows or an object of columns.");
  if (entries.length === 0 && problems.length === 0)
    problems.push("No column, value and label could be read from this codebook.");
  return { entries, problems };
}

/** Reads a codebook from its text: JSON (an object of columns, or a list of rows) or delimited text with a header row. */
export function parseCodebook(text: string): CodebookParse {
  const body = text.replace(/^\uFEFF/, "");
  if (body.trim() === "") return { entries: [], problems: ["The codebook is empty."] };
  const parsed = /^\s*[[{]/.test(body) ? parseJson(body) : parseDelimited(body);
  if (parsed.entries.length > MAX_ENTRIES)
    return {
      entries: parsed.entries.slice(0, MAX_ENTRIES),
      problems: [
        ...parsed.problems,
        `Only the first ${MAX_ENTRIES.toLocaleString("en-US")} entries were read.`,
      ],
    };
  return parsed;
}

export interface CodebookMatch {
  /** Labels to keep, by column name then value. */
  labels: Record<string, Record<string, string>>;
  applied: number;
  columns: number;
  /** Entries whose column or value is not in the table. */
  unmatched: number;
}

/** A number written another way (1.0, 01) reads as the same code. */
const canon = (v: string): string =>
  /^-?\d+(\.\d+)?$/.test(v.trim()) ? String(Number(v)) : v.trim();

/**
 * Keeps the labels that belong to a column and a value of the table: a category label or a sentinel code the profile already
 * holds. A label for a value the table does not have is counted, not kept.
 */
export function matchCodebook(
  entries: readonly CodebookEntry[],
  profiles: readonly ColumnProfile[],
): CodebookMatch {
  const byName = new Map(profiles.map((p) => [p.name.toLowerCase(), p]));
  const labels: Record<string, Record<string, string>> = {};
  let applied = 0;
  let unmatched = 0;
  for (const e of entries) {
    const p = byName.get(e.column.toLowerCase());
    if (!p) {
      unmatched++;
      continue;
    }
    const known = [
      ...(p.summary.kind === "categorical" ? Object.keys(p.summary.counts) : []),
      ...Object.keys(p.sentinels),
    ];
    const value = known.find((k) => canon(k) === canon(e.value));
    if (value === undefined) {
      unmatched++;
      continue;
    }
    (labels[p.name] ??= {})[value] = e.label;
    applied++;
  }
  return { labels, applied, columns: Object.keys(labels).length, unmatched };
}
