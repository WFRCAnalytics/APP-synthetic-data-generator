// The one-line summaries shown beside the title of each settings group, and whether a group needs a look. Pure functions of a profile.

import type { ColumnProfile } from "../../lib/profile/types";
import type { TableInfo } from "./ChildCountPanel";
import { typeLabel } from "./summary";

const n = (x: number): string => x.toLocaleString("en-US");

/** What the app made of the column: its kind, and what it found that counts as missing or special. */
export function readSummary(p: ColumnProfile): string {
  const parts = [typeLabel(p.type)];
  const codes = Object.keys(p.sentinels).length;
  if (codes > 0) parts.push(`${codes} special ${codes === 1 ? "code" : "codes"}`);
  if (p.naCount > 0) parts.push(`${n(p.naCount)} missing`);
  return parts.join(", ");
}

/** Whether the group of how the column was read needs a look: the app was unsure, or could not read it. */
export const readNeedsLook = (p: ColumnProfile): boolean => p.status !== "ok" || p.attentionReasons.length > 0;

const COUNTS = { exact: "exact counts", rounded: "rounded counts", equal: "equal shares" } as const;
const RANGE = { exact: "exact range", rounded: "widened range" } as const;
const SHAPE = { match_shape: "same shape", match_mean_sd: "average and spread", uniform: "even spread" } as const;

/** What the fake column keeps of the real one. */
export function keepSummary(p: ColumnProfile): string {
  const k = p.keep ?? {};
  const s = p.summary.kind;
  if (p.fromParent) return "Takes the other table's value";
  if (s === "categorical") return [COUNTS[k.counts ?? "exact"], p.naCount > 0 ? `missing ${k.missing ?? "exact"}` : null].filter(Boolean).join(", ");
  if ((s === "numeric" || s === "datetime") && !p.coordinate) return [RANGE[k.range ?? "exact"], SHAPE[p.mode ?? "match_mean_sd"]].join(", ");
  if (s === "numeric") return "Bounding box only";
  if (s === "personal" || s === "short_string" || s === "free_text" || s === "survey_id") return "Nothing real is kept";
  return "Nothing to choose";
}

/** How the column is written in the fake file. */
export function writeSummary(p: ColumnProfile, workbook: boolean): string {
  const parts = [p.outputName === p.name ? "Same name" : `Written as ${p.outputName}`];
  if (workbook && p.cellFormat) parts.push(`Excel format ${p.cellFormat}`);
  if (p.exclude === "drop") parts.push("left out");
  if (p.exclude === "keep_as_na") parts.push("kept empty");
  return parts.join(", ");
}

/** Whether the column can be connected to another table at all, so the group is worth showing. */
export function canConnect(p: ColumnProfile, table: TableInfo | undefined): boolean {
  if (p.summary.kind === "survey_id") return true;
  if (p.childCount || p.fromParent) return true;
  if (!table) return false;
  const k = p.summary.kind;
  const countable = k === "numeric" && p.type === "integer" && p.naCount === 0 && Object.keys(p.sentinels).length === 0 && table.idColumns.length > 0;
  const followable = (k === "categorical" || k === "numeric" || k === "datetime") && p.naCount === 0 && Object.keys(p.sentinels).length === 0 && (table.linkedIds?.length ?? 0) > 0;
  return countable || followable;
}

/** Whether the column is connected to another table, and how. */
export function connectSummary(p: ColumnProfile): string {
  if (p.idLink) return `IDs from ${p.idLink.table ?? "another table"}`;
  if (p.childCount) return `Counts the rows of ${p.childCount.child.table ?? "another table"}`;
  if (p.fromParent) return `Value from ${p.fromParent.parent.table ?? "another table"}`;
  return "Not connected";
}
