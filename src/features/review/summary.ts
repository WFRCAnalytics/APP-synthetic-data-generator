// Plain-language text and chart data for a column card (FR-009). Only summaries are shown: labels,
// counts, min and max, which the privacy model allows. No row of the real file appears anywhere.

import { formatDate, fromNumber, patternKind } from "../../lib/datefmt/directives";
import type { ColumnProfile, ReasonCode } from "../../lib/profile/types";

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
  unsupported: "Unsupported in this version",
};

export const typeLabel = (type: string): string => TYPE_LABELS[type] ?? type;

const REASON_TEXT: Record<ReasonCode, string> = {
  possible_sentinel: "Some values look like codes for “don't know” or “refused”. They are kept with their exact counts and left out of min, max, mean and spread.",
  possible_identifier: "This looks like personal data, so none of its values are used.",
  near_categorical_threshold: "The number of distinct values is close to the limit between coded and numeric columns.",
  date_format_unrecognized: "Some values do not match the detected date format.",
  date_format_mixed: "This column mixes more than one date format.",
  date_format_ambiguous: "Day and month could be in either order; the first reading was used.",
  id_mask_too_narrow: "The ID pattern allows fewer distinct values than the column needs.",
  id_mixed_masks: "The IDs follow more than one pattern.",
  beta_fit_failed: "The mean and spread cannot be matched on this range, so values are spread evenly instead.",
  possible_na_token: "A few non-numeric markers were treated as missing values.",
  id_not_yet_supported: "Survey ID patterns are not available yet, so this column is left out of the fake file.",
  unsupported_type: "This kind of column is not supported in this version, so it is left out of the fake file.",
};

export const reasonText = (code: ReasonCode): string => REASON_TEXT[code] ?? code;

const fmt = (n: number): string => (Number.isInteger(n) ? n.toLocaleString("en-US") : String(Math.round(n * 1e6) / 1e6));

/** One-line facts about a column, in reading order. */
export function summaryLines(p: ColumnProfile): string[] {
  const s = p.summary;
  const lines: string[] = [];

  switch (s.kind) {
    case "categorical": {
      const entries = Object.entries(s.counts);
      lines.push(`${entries.length} ${entries.length === 1 ? "value" : "values"}`);
      const top = entries.slice(0, 3).map(([label, n]) => `${label === "" ? "(blank)" : label}: ${n.toLocaleString("en-US")}`);
      if (top.length > 0) lines.push(top.join(" · ") + (entries.length > 3 ? " · …" : ""));
      break;
    }
    case "numeric":
      lines.push(`Range ${fmt(s.min)} to ${fmt(s.max)}`);
      lines.push(`Mean ${fmt(s.mean)} · spread ${fmt(s.sd)}`);
      break;
    case "datetime": {
      if (s.format) {
        const kind = patternKind(s.format);
        lines.push(`Range ${formatDate(fromNumber(s.min, kind), s.format)} to ${formatDate(fromNumber(s.max, kind), s.format)}`);
        lines.push(`Format ${s.format}`);
      }
      break;
    }
    case "survey_id":
      lines.push(`${s.distinct.toLocaleString("en-US")} distinct IDs`);
      break;
    case "empty":
      lines.push("Every value is missing");
      break;
    case "unsupported":
      lines.push("Left out of the fake file");
      break;
  }

  if (p.naCount > 0) lines.push(`Missing: ${p.naCount.toLocaleString("en-US")}`);
  const sentinels = Object.entries(p.sentinels);
  if (sentinels.length > 0) lines.push(`Codes kept: ${sentinels.map(([v, n]) => `${v} (${n.toLocaleString("en-US")})`).join(", ")}`);
  return lines;
}

/** Bar heights between 0 and 1 for the card chart, drawn from the summary (no values needed). */
export function sparkBars(p: ColumnProfile): number[] {
  const s = p.summary;
  let raw: number[] = [];
  if (s.kind === "categorical") raw = Object.values(s.counts).sort((a, b) => b - a).slice(0, 24);
  else if (s.kind === "numeric" || s.kind === "datetime") raw = s.histogram;
  const max = Math.max(0, ...raw);
  return max > 0 ? raw.map((n) => n / max) : [];
}
