// Number format codes (specs/003 FR-006, research R5): what a code such as `#,##0.00` or `mm/dd/yyyy`
// says about a column. Only the code is read, never a value. Used to keep decimals, thousands
// separators and date display when a fake workbook is written.

export type FormatKind = "general" | "number" | "percent" | "currency" | "scientific" | "date" | "time" | "datetime" | "text";

export interface FormatInfo {
  code: string;
  kind: FormatKind;
  /** Decimals the code shows, or null when it has none of its own (general, dates, text). */
  decimals: number | null;
  /** The code has a thousands separator. */
  thousands: boolean;
}

// The codes Excel gives the built-in ids. Locale-dependent ones (14, and the currency ids) use the
// US form, which is also what Excel writes when it saves them.
const BUILT_IN: Record<number, string> = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  5: "$#,##0_);($#,##0)",
  6: "$#,##0_);[Red]($#,##0)",
  7: "$#,##0.00_);($#,##0.00)",
  8: "$#,##0.00_);[Red]($#,##0.00)",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  14: "mm-dd-yy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yy h:mm",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  41: '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)',
  42: '_($* #,##0_);_($* \\(#,##0\\);_($* "-"_);_(@_)',
  43: '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)',
  44: '_($* #,##0.00_);_($* \\(#,##0.00\\);_($* "-"??_);_(@_)',
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mmss.0",
  48: "##0.0E+0",
  49: "@",
};

/** The code behind a built-in format id (0 to 49), or null for custom ids and ids Excel leaves undefined. */
export const builtInFormat = (id: number): string | null => BUILT_IN[id] ?? null;

/** The first section of a code (the one for positive numbers) with quoted text, escapes and brackets removed. */
function skeleton(code: string): string {
  const first = splitSections(code)[0];
  let out = "";
  for (let i = 0; i < first.length; i++) {
    const ch = first[i];
    if (ch === '"') {
      i = first.indexOf('"', i + 1);
      if (i < 0) break;
    } else if (ch === "\\" || ch === "_" || ch === "*") {
      i++; // the next character is a literal, a space width or a fill character
    } else if (ch === "[") {
      const end = first.indexOf("]", i);
      const inside = end < 0 ? "" : first.slice(i + 1, end);
      // [h], [mm] and [ss] are elapsed time; colors, conditions and locales are not part of the shape.
      if (/^(h+|m+|s+)$/i.test(inside)) out += inside[0];
      else if (/^\$/.test(inside) && /[^-\d$a-fA-F,]/.test(inside.replace(/-[0-9A-Fa-f]+$/, ""))) out += "$"; // [$£-809]: a currency symbol
      i = end < 0 ? first.length : end;
    } else out += ch;
  }
  return out;
}

/** Splits at semicolons that are not inside quotes or brackets. */
function splitSections(code: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = false;
  let cur = "";
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === "\\") {
      cur += ch + (code[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === '"') quote = !quote;
    else if (!quote && ch === "[") depth++;
    else if (!quote && ch === "]") depth = Math.max(0, depth - 1);
    if (ch === ";" && !quote && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

function kindOf(code: string): FormatKind {
  const trimmed = code.trim();
  if (trimmed === "" || /^general$/i.test(trimmed)) return "general";
  const s = skeleton(code);
  if (/^@$/.test(s.trim()) || (s.includes("@") && !/[0#?]/.test(s) && !/[ymdhs]/i.test(s))) return "text";

  const hasDate = /[ydYD]/.test(s) || (/m/i.test(s) && !/[hs]/i.test(s) && !/[0#?]/.test(s));
  const hasTime = /[hHsS]/.test(s) || /AM\/PM|A\/P/i.test(s);
  if (hasDate && hasTime) return "datetime";
  if (hasDate) return "date";
  if (hasTime) return "time";

  if (/E[+-]/i.test(s)) return "scientific";
  if (s.includes("%")) return "percent";
  // A currency symbol is often written in quotes, which the skeleton drops.
  if (/[$€£¥]/.test(s) || /"[^"]*[$€£¥][^"]*"/.test(splitSections(code)[0])) return "currency";
  return "number";
}

/** Reads a number format code. */
export function describeFormat(code: string): FormatInfo {
  const kind = kindOf(code);
  const s = skeleton(code);
  let decimals: number | null = null;
  if (kind === "number" || kind === "percent" || kind === "currency" || kind === "scientific") {
    const dot = s.indexOf(".");
    decimals = 0;
    if (dot >= 0) {
      const m = /^[0#?]*/.exec(s.slice(dot + 1));
      decimals = m ? m[0].length : 0;
    }
  }
  const thousands = (kind === "number" || kind === "currency") && /[0#?],[0#?]/.test(s);
  return { code, kind, decimals, thousands };
}
