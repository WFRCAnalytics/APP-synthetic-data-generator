// Telling an SPSS, Stata or SAS file from its first bytes and its name (specs/017, specs/022). Pure.

export type StatFormat = "sav" | "dta" | "sas7bdat" | "xpt";

export const STAT_FORMAT_NAMES: Record<StatFormat, string> = { sav: "SPSS", dta: "Stata", sas7bdat: "SAS", xpt: "SAS transport" };

/**
 * The formats the app can also write. A .sas7bdat is read only: ReadStat's writer for it is reverse-engineered, so real SAS cannot
 * open its files. A transport file (.xpt) is a published format, so it can be written.
 */
export const WRITABLE_FORMATS: readonly StatFormat[] = ["sav", "dta", "xpt"];

/** The file types a table can be converted to after it is made (as a CSV): the statistical formats the app writes itself. */
export type ConvertKind = "sav" | "dta" | "xpt";

export const CONVERT_KINDS: readonly { value: ConvertKind; label: string; extension: string }[] = [
  { value: "sav", label: "SPSS", extension: "sav" },
  { value: "dta", label: "Stata", extension: "dta" },
  { value: "xpt", label: "SAS transport", extension: "xpt" },
];

export const isConvertKind = (value: string): value is ConvertKind => CONVERT_KINDS.some((k) => k.value === value);

/** How many bytes of the start of a file are needed to tell them apart. */
export const DETECT_BYTES = 64;

const ascii = (bytes: Uint8Array, at: number, text: string): boolean => text.split("").every((ch, i) => bytes[at + i] === ch.charCodeAt(0));
const SAS7BDAT_MAGIC = [0xc2, 0xea, 0x81, 0x60, 0xb3, 0x14, 0x11, 0xcf, 0xbd, 0x92, 0x08, 0x00, 0x09, 0xc7, 0x31, 0x8c];

/**
 * The format of a file, or null when it is none of them. SPSS files (.sav, .zsav) begin "$FL2" or "$FL3"; Stata files begin
 * "<stata_dta>" (versions 13 and later) or hold a release number from 102 to 119 in the first byte (older ones, which also need
 * the name to end in .dta so that text files are never mistaken for them); SAS data sets hold a fixed 16-byte signature after
 * twelve zero bytes; SAS transport files begin "HEADER RECORD*******".
 */
export function detectStat(head: Uint8Array, fileName: string): StatFormat | null {
  if (ascii(head, 0, "$FL2") || ascii(head, 0, "$FL3")) return "sav";
  if (ascii(head, 0, "<stata_dta>")) return "dta";
  if (head.length >= 28 && SAS7BDAT_MAGIC.every((b, i) => head[12 + i] === b)) return "sas7bdat";
  if (ascii(head, 0, "HEADER RECORD*******")) return "xpt";
  if (/\.dta$/i.test(fileName) && head.length >= 4 && head[0] >= 102 && head[0] <= 119 && (head[1] === 1 || head[1] === 2)) return "dta";
  return null;
}

/** The name the table is known by after it is read: the data is handled as a table and written as a CSV unless another type is chosen. */
export const csvNameOf = (fileName: string): string => `${fileName.replace(/\.[^.]*$/, "") || "table"}.csv`;

/** True when the name says SPSS, Stata or SAS (used to explain a file that does not read). */
export const hasStatExtension = (fileName: string): boolean => /\.(sav|zsav|dta|sas7bdat|xpt)$/i.test(fileName);
