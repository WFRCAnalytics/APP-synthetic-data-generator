// What a design must satisfy before it can become a spec. Every message says what to change, in the
// words of the form, and names the field so it can be shown next to it.

import { isSupportedPattern } from "../datefmt/directives";
import { MAX_DESIGN_COLUMNS, MAX_DESIGN_ROWS, type Design, type DesignColumn, type DesignProblem } from "./types";

const MAX_NAME_LENGTH = 100;
const MAX_LABELS = 200;
const MAX_TEXT_LENGTH = 5000;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex
const FILE_NAME_BAD = /[\\/:*?"<>|\u0000-\u001f]/;

/** A year-month-day text such as 2024-03-31, as a UTC time; null when it is not a real day. */
export function parseDay(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t : null;
}

/** How many rows hold a value once the missing share is taken out. */
export const presentRows = (rows: number, missingPct: number): number => rows - missingCount(rows, missingPct);
export const missingCount = (rows: number, missingPct: number): number => Math.round((rows * Math.min(100, Math.max(0, missingPct))) / 100);

function columnProblems(c: DesignColumn, rows: number, names: Map<string, number>): DesignProblem[] {
  const out: DesignProblem[] = [];
  const add = (field: string, message: string) => out.push({ columnId: c.id, field, message });

  const name = c.name.trim();
  if (name === "") add("name", "Give this column a name.");
  else if (name.length > MAX_NAME_LENGTH) add("name", `Use a name of ${MAX_NAME_LENGTH} characters or fewer.`);
  else if (CONTROL.test(c.name)) add("name", "A name cannot contain line breaks or other control characters.");
  else if ((names.get(name.toLowerCase()) ?? 0) > 1) add("name", "Another column has this name. Names must be different.");

  if (!Number.isFinite(c.missingPct) || c.missingPct < 0 || c.missingPct > 100) add("missingPct", "Enter a share from 0 to 100 percent.");

  switch (c.kind) {
    case "integer":
    case "decimal": {
      if (!Number.isFinite(c.min)) add("min", "Enter the smallest value.");
      if (!Number.isFinite(c.max)) add("max", "Enter the largest value.");
      if (Number.isFinite(c.min) && Number.isFinite(c.max) && !(c.max > c.min)) add("max", "The largest value must be more than the smallest.");
      if (c.kind === "integer" && Number.isFinite(c.min) && !Number.isInteger(c.min)) add("min", "A whole number column needs a whole smallest value.");
      if (c.kind === "integer" && Number.isFinite(c.max) && !Number.isInteger(c.max)) add("max", "A whole number column needs a whole largest value.");
      if (c.kind === "decimal" && !(Number.isInteger(c.decimals) && c.decimals >= 0 && c.decimals <= 15)) add("decimals", "Decimal places must be a whole number from 0 to 15.");
      if (c.shape === "bell") {
        if (!(Number.isFinite(c.spread) && c.spread > 0)) add("spread", "The spread must be more than 0.");
        if (!(Number.isFinite(c.typical) && c.typical >= c.min && c.typical <= c.max)) add("typical", "The typical value must be between the smallest and the largest.");
      }
      break;
    }
    case "category": {
      if (c.labels.length === 0) add("labels", "Add at least one label.");
      if (c.labels.length > MAX_LABELS) add("labels", `Use ${MAX_LABELS} labels or fewer.`);
      const seen = new Set<string>();
      for (const l of c.labels) {
        if (l.label.trim() === "") add("labels", "A label cannot be blank.");
        else if (CONTROL.test(l.label)) add("labels", "A label cannot contain line breaks or other control characters.");
        else if (seen.has(l.label)) add("labels", `The label "${l.label}" appears twice. Labels must be different.`);
        seen.add(l.label);
        if (!(Number.isFinite(l.weight) && l.weight > 0)) add("labels", `Give "${l.label}" a weight above 0.`);
      }
      break;
    }
    case "yesno": {
      if (c.yesLabel.trim() === "" || c.noLabel.trim() === "") add("labels", "Both labels need text.");
      else if (c.yesLabel === c.noLabel) add("labels", "The two labels must be different.");
      if (CONTROL.test(c.yesLabel) || CONTROL.test(c.noLabel)) add("labels", "A label cannot contain line breaks or other control characters.");
      if (!(Number.isFinite(c.yesPct) && c.yesPct >= 0 && c.yesPct <= 100)) add("yesPct", "Enter a share from 0 to 100 percent.");
      break;
    }
    case "date":
    case "datetime": {
      const a = parseDay(c.start);
      const b = parseDay(c.end);
      if (a === null) add("start", "Enter the first day as year-month-day, such as 2024-03-31.");
      if (b === null) add("end", "Enter the last day as year-month-day, such as 2024-03-31.");
      if (a !== null && b !== null && b < a) add("end", "The last day cannot be before the first day.");
      if (!isSupportedPattern(c.format)) add("format", "Choose one of the listed formats.");
      break;
    }
    case "id": {
      if (!(Number.isInteger(c.digits) && c.digits >= 1 && c.digits <= 15)) add("digits", "Digits must be a whole number from 1 to 15.");
      if (c.prefix.length > 20) add("prefix", "Use a prefix of 20 characters or fewer.");
      if (CONTROL.test(c.prefix)) add("prefix", "A prefix cannot contain line breaks or other control characters.");
      if (Number.isInteger(c.digits) && c.digits >= 1 && c.digits <= 15 && 10 ** c.digits < presentRows(rows, c.missingPct)) {
        add("digits", `${c.digits} digits allow ${(10 ** c.digits).toLocaleString("en-US")} different IDs, but the table needs ${presentRows(rows, c.missingPct).toLocaleString("en-US")}. Add digits.`);
      }
      break;
    }
    case "personal":
      break;
    case "text": {
      if (!(Number.isInteger(c.minLength) && c.minLength >= 1)) add("minLength", "The shortest length must be a whole number, 1 or more.");
      if (!(Number.isInteger(c.maxLength) && c.maxLength <= MAX_TEXT_LENGTH)) add("maxLength", `The longest length must be a whole number, ${MAX_TEXT_LENGTH.toLocaleString("en-US")} or less.`);
      else if (Number.isInteger(c.minLength) && c.maxLength < c.minLength) add("maxLength", "The longest length cannot be less than the shortest.");
      break;
    }
  }
  return out;
}

export function validateDesign(design: Design): DesignProblem[] {
  const out: DesignProblem[] = [];
  const name = design.tableName.trim();
  if (name === "") out.push({ columnId: null, field: "tableName", message: "Give the table a name." });
  else if (name.length > 100 || FILE_NAME_BAD.test(name) || name.startsWith(".")) out.push({ columnId: null, field: "tableName", message: "Use a name without slashes, colons, quotes or other characters a file name cannot hold." });
  if (!(Number.isInteger(design.rows) && design.rows >= 1 && design.rows <= MAX_DESIGN_ROWS)) {
    out.push({ columnId: null, field: "rows", message: `Enter a whole number of rows from 1 to ${MAX_DESIGN_ROWS.toLocaleString("en-US")}.` });
  }
  if (!(Number.isInteger(design.seed) && design.seed >= 0 && design.seed <= 4294967295)) out.push({ columnId: null, field: "seed", message: "Enter a whole number from 0 to 4,294,967,295 as the seed." });
  if (design.columns.length > MAX_DESIGN_COLUMNS) out.push({ columnId: null, field: "columns", message: `Use ${MAX_DESIGN_COLUMNS} columns or fewer.` });

  const names = new Map<string, number>();
  for (const c of design.columns) {
    const key = c.name.trim().toLowerCase();
    names.set(key, (names.get(key) ?? 0) + 1);
  }
  const rows = Number.isInteger(design.rows) ? design.rows : 0;
  for (const c of design.columns) out.push(...columnProblems(c, rows, names));
  return out;
}
