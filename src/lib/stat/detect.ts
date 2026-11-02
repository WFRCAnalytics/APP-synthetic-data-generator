// Telling an SPSS or Stata file from its first bytes and its name (specs/017 FR-001). Pure.

export type StatFormat = "sav" | "dta";

export const STAT_FORMAT_NAMES: Record<StatFormat, string> = { sav: "SPSS", dta: "Stata" };

const ascii = (bytes: Uint8Array, at: number, text: string): boolean =>
  text.split("").every((ch, i) => bytes[at + i] === ch.charCodeAt(0));

/**
 * The format of a file, or null when it is neither. SPSS files (.sav, .zsav) begin "$FL2" or "$FL3"; Stata files
 * begin "<stata_dta>" (versions 13 and later) or hold a release number from 102 to 119 in the first byte (older
 * ones, which also need the name to end in .dta so that text files are never mistaken for them).
 */
export function detectStat(head: Uint8Array, fileName: string): StatFormat | null {
  if (ascii(head, 0, "$FL2") || ascii(head, 0, "$FL3")) return "sav";
  if (ascii(head, 0, "<stata_dta>")) return "dta";
  if (
    /\.dta$/i.test(fileName) &&
    head.length >= 4 &&
    head[0] >= 102 &&
    head[0] <= 119 &&
    (head[1] === 1 || head[1] === 2)
  )
    return "dta";
  return null;
}

/** The name the table is known by after it is read: the data is written back as CSV. */
export const csvNameOf = (fileName: string): string =>
  `${fileName.replace(/\.[^.]*$/, "") || "table"}.csv`;

/** True when the name says SPSS or Stata (used to explain a file that does not read). */
export const hasStatExtension = (fileName: string): boolean => /\.(sav|zsav|dta)$/i.test(fileName);
