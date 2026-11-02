// A finished fake CSV turned into typed columns, ready to be written as an SPSS or Stata file (specs/018). Nothing
// here sees real data: the text is the generated fake table. A column becomes a number, a date, a date and time or a
// time only when the spec says so and every filled cell reads that way; anything else is written as text, so no
// value is ever lost or invented.

import { splitRecords } from "../csv/sniff";

export type StatKind = "number" | "date" | "datetime" | "time" | "string";

export interface StatColumn {
  name: string;
  kind: StatKind;
  /** Number of decimals shown for a number (the most any value has, at most 8). */
  decimals: number;
  /** For text: the widest value in bytes (UTF-8), at least 1. */
  width: number;
  /** Numbers as numbers, dates as days since 1970-01-01, date and times as seconds, times as seconds of the day; null is missing. */
  values: (number | string | null)[];
}

export interface StatTable {
  columns: StatColumn[];
  rowCount: number;
  /** Text cells that were cut to fit the longest text the format allows. */
  truncated: number;
}

const NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?$/;
const TIME = /^(\d{2}):(\d{2}):(\d{2})$/;

const encoder = new TextEncoder();

/** The spec column types that hold numbers, and the ones that hold codes that may be numbers. */
const NUMERIC_HINTS = new Set(["integer", "float"]);

const daysOf = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d) / 86_400_000;

/** The text cut to at most `max` bytes without splitting a character. */
export function cutToBytes(text: string, max: number): string {
  if (encoder.encode(text).length <= max) return text;
  let out = "";
  let bytes = 0;
  for (const ch of text) {
    const n = encoder.encode(ch).length;
    if (bytes + n > max) break;
    out += ch;
    bytes += n;
  }
  return out;
}

/**
 * @param csv the fake CSV as text (UTF-8, comma, quotes, header row)
 * @param hints the spec type of each column by name ("integer", "date", ...); a column without a hint is text
 * @param maxText the longest text the target format can hold, in bytes
 */
export function tableFromCsv(csv: string, hints: Record<string, string>, maxText: number): StatTable {
  const { rows } = splitRecords(csv.replace(/^﻿/, ""), ",", '"', false, Number.MAX_SAFE_INTEGER);
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  let truncated = 0;

  const columns = header.map((name, c): StatColumn => {
    const cells = body.map((r) => r[c] ?? "");
    const filled = cells.filter((v) => v !== "");
    const hint = hints[name] ?? "";
    const all = (re: RegExp) => filled.every((v) => re.test(v));

    let kind: StatKind = "string";
    if (filled.length > 0) {
      if (NUMERIC_HINTS.has(hint) && all(NUMBER)) kind = "number";
      else if (hint === "categorical" && all(NUMBER) && filled.every((v) => !/^-?0\d/.test(v))) kind = "number";
      else if (hint === "date" && all(DATE)) kind = "date";
      else if (hint === "datetime" && all(DATETIME)) kind = "datetime";
      else if (hint === "time" && all(TIME)) kind = "time";
    }

    const values = cells.map((v): number | string | null => {
      if (v === "") return null;
      switch (kind) {
        case "number":
          return Number(v);
        case "date": {
          const m = DATE.exec(v)!;
          return daysOf(+m[1], +m[2], +m[3]);
        }
        case "datetime": {
          const m = DATETIME.exec(v)!;
          return daysOf(+m[1], +m[2], +m[3]) * 86_400 + +m[4] * 3600 + +m[5] * 60 + +m[6];
        }
        case "time": {
          const m = TIME.exec(v)!;
          return +m[1] * 3600 + +m[2] * 60 + +m[3];
        }
        default: {
          const cut = cutToBytes(v, maxText);
          if (cut !== v) truncated++;
          return cut;
        }
      }
    });

    let decimals = 0;
    let width = 1;
    if (kind === "number") {
      for (const v of filled) {
        const m = /\.(\d+)/.exec(v.replace(/[eE].*$/, ""));
        if (m) decimals = Math.max(decimals, m[1].length);
      }
      decimals = Math.min(decimals, 8);
    } else if (kind === "string") {
      for (const v of values) if (typeof v === "string") width = Math.max(width, encoder.encode(v).length);
    }
    return { name, kind, decimals, width, values };
  });

  return { columns, rowCount: body.length, truncated };
}

/** Names that the format accepts: invalid characters become "_", a bad first character gets a prefix, repeats get a number. */
export function safeNames(names: readonly string[], valid: RegExp, max: number, caseInsensitive: boolean): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let n = [...name].map((ch) => (valid.test(ch) ? ch : "_")).join("");
    if (n === "" || !/^[A-Za-z_@#$]/.test(n)) n = `v${n}`;
    n = cutToBytes(n, max).replace(/\.$/, "_");
    let candidate = n;
    for (let i = 2; used.has(caseInsensitive ? candidate.toUpperCase() : candidate); i++) {
      const suffix = `_${i}`;
      candidate = cutToBytes(n, max - suffix.length) + suffix;
    }
    used.add(caseInsensitive ? candidate.toUpperCase() : candidate);
    return candidate;
  });
}
