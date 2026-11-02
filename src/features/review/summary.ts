// Plain-language text and chart data for a column card (FR-009). Only summaries are shown: labels,
// counts, min and max, which the privacy model allows. No row of the real file appears anywhere.

import { AXIS_LABELS } from "../../lib/classify/coordinate";
import { formatDate, fromNumber, patternKind } from "../../lib/datefmt/directives";
import { maskToRegexString } from "../../lib/mask/mask";
import { describeParquetType, typeConflict } from "../../lib/parquet/types";
import type { ColumnProfile, PersonalKind, ReasonCode } from "../../lib/profile/types";

export const PERSONAL_LABELS: Record<PersonalKind, string> = {
  full_name: "full names",
  first_name: "first names",
  last_name: "last names",
  email: "email addresses",
  phone: "phone numbers",
  address: "street addresses",
  url: "web addresses",
  ip: "IP addresses",
  ssn: "social-security-style numbers",
};

const TYPE_LABELS: Record<string, string> = {
  empty: "Empty",
  boolean: "Yes/No",
  categorical: "Categorical",
  integer: "Integer",
  float: "Decimal",
  date: "Date",
  datetime: "Date and time",
  time: "Time",
  survey_id: "Survey ID",
  personal: "Personal identifier",
  free_text: "Free text",
  short_string: "Short string",
  unsupported: "Unsupported in this version",
};

export const typeLabel = (type: string): string => TYPE_LABELS[type] ?? type;

const REASON_TEXT: Record<ReasonCode, string> = {
  mixed_kinds:
    "This key holds more than one kind of value (numbers and text, say), so every value is read and written as text.",
  possible_sentinel:
    "Some values look like codes for “don't know” or “refused”. They are kept with their exact counts and left out of min, max, mean and spread.",
  possible_identifier: "This looks like personal data, so none of its values are used.",
  near_categorical_threshold:
    "The number of distinct values is close to the limit between coded and numeric columns.",
  date_format_unrecognized: "Some values do not match the detected date format.",
  date_format_mixed: "This column mixes more than one date format.",
  date_format_ambiguous: "Day and month could be in either order; the first reading was used.",
  id_mask_too_narrow: "The ID pattern allows fewer distinct values than the column needs.",
  id_mixed_masks: "The IDs follow more than one pattern.",
  beta_fit_failed:
    "The mean and spread cannot be matched on this range, so values are spread evenly instead.",
  possible_na_token: "A few non-numeric markers were treated as missing values.",
  override_not_possible:
    "The type you chose does not fit this column's values, so the detected type was kept.",
  id_not_yet_supported:
    "Survey ID patterns are not available yet, so this column is left out of the fake file.",
  unsupported_type:
    "This kind of column is not supported in this version, so it is left out of the fake file.",
  mixed_cells:
    "This column mixes numbers, dates and text, so every value was read as text. Check how it is typed.",
  merged_cells:
    "This sheet has merged cells. A merged value is read once, in its top-left cell, and the other cells of the merge are blank.",
  format_mismatch:
    "The cells of this column carry different kinds of number format, so the format of the first cells was used.",
  sheet_hidden: "This sheet is hidden in the workbook.",
  kind_mixed:
    "The values look like more than one kind, so the commonest kind was proposed. Check it or choose another.",
  suffix_needed:
    "More distinct values are needed than can be invented naturally, so a short number is added to some of them.",
  ssn_needs_acknowledgement:
    "This looks like social-security-style numbers. It stays left out unless you accept that invented numbers will be generated.",
  text_length_capped:
    "Some values are longer than 100,000 characters; they are counted as 100,000.",
  needs_source_file:
    "Open the original file to change this column's kind; a saved spec has no figures for it.",
};

export const reasonText = (code: ReasonCode): string => REASON_TEXT[code] ?? code;

// Whole numbers with separators; others to six significant digits, so a mean reads 299.24, not 299.240235.
const fmt = (n: number): string =>
  Number.isInteger(n) ? n.toLocaleString("en-US") : String(Number(n.toPrecision(6)));

/** One-line facts about a column, in reading order. */
export function summaryLines(p: ColumnProfile): string[] {
  const s = p.summary;
  const lines: string[] = [];

  switch (s.kind) {
    case "categorical": {
      const entries = Object.entries(s.counts);
      lines.push(`${entries.length} ${entries.length === 1 ? "value" : "values"}`);
      const named = (label: string) =>
        `${label === "" ? "(blank)" : label}${p.valueLabels?.[label] ? ` (${p.valueLabels[label]})` : ""}`;
      const top = entries
        .slice(0, 3)
        .map(([label, n]) => `${named(label)}: ${n.toLocaleString("en-US")}`);
      if (top.length > 0) lines.push(top.join(" · ") + (entries.length > 3 ? " · …" : ""));
      break;
    }
    case "numeric":
      if (p.coordinate) {
        lines.push(`${AXIS_LABELS[p.coordinate]} from ${fmt(s.min)} to ${fmt(s.max)}`);
        lines.push("Only the bounding box is kept");
        break;
      }
      lines.push(`Range ${fmt(s.min)} to ${fmt(s.max)}`);
      lines.push(`Mean ${fmt(s.mean)} · spread ${fmt(s.sd)}`);
      break;
    case "datetime": {
      if (s.format) {
        const kind = patternKind(s.format);
        lines.push(
          `Range ${formatDate(fromNumber(s.min, kind), s.format)} to ${formatDate(fromNumber(s.max, kind), s.format)}`,
        );
        lines.push(`Format ${s.format}`);
      }
      break;
    }
    case "survey_id":
      lines.push(`${s.distinct.toLocaleString("en-US")} distinct IDs`);
      break;
    case "personal":
      lines.push(
        `Invented ${PERSONAL_LABELS[s.personalKind]}, ${s.distinct.toLocaleString("en-US")} distinct`,
      );
      break;
    case "free_text":
      lines.push(`Length ${fmt(s.min)} to ${fmt(s.max)} characters`);
      lines.push(`Typical length ${fmt(s.mean)}`);
      break;
    case "short_string":
      lines.push(
        `${s.distinct.toLocaleString("en-US")} distinct values, pattern ${maskToRegexString(s.pattern)}`,
      );
      break;
    case "empty":
      lines.push("Every value is missing");
      break;
    case "unsupported":
      lines.push("Left out of the fake file");
      break;
  }

  if (p.naCount > 0) lines.push(`Missing: ${p.naCount.toLocaleString("en-US")}`);
  const sentinels = Object.entries(p.sentinels).sort((a, b) => Number(a[0]) - Number(b[0]));
  if (sentinels.length > 0)
    lines.push(
      `Codes kept: ${sentinels.map(([v, n]) => `${v}${p.valueLabels?.[v] ? ` ${p.valueLabels[v]}` : ""} (${n.toLocaleString("en-US")})`).join(", ")}`,
    );
  if (p.parquetType)
    lines.push(
      `File type: ${describeParquetType(p.parquetType)}${p.parquetType.nullable ? "" : ", required"}`,
    );
  return lines;
}

/** Why the type chosen for a column cannot be written with the type it has in the Parquet file, or null. */
export function parquetConflict(p: ColumnProfile): string | null {
  if (!p.parquetType || p.exclude === "drop" || p.type === "unsupported" || p.type === "empty")
    return null;
  return typeConflict(p.type, p.parquetType.kind);
}

/** Bar heights between 0 and 1 for the card chart, drawn from the summary (no values needed). */
export function sparkBars(p: ColumnProfile): number[] {
  const s = p.summary;
  let raw: number[] = [];
  if (s.kind === "categorical")
    raw = Object.values(s.counts)
      .sort((a, b) => b - a)
      .slice(0, 24);
  else if (s.kind === "numeric" || s.kind === "datetime" || s.kind === "free_text")
    raw = s.histogram;
  const max = Math.max(0, ...raw);
  return max > 0 ? raw.map((n) => n / max) : [];
}
