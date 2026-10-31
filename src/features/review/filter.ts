// Search and filters for the column list (FR-010), so a table with 120 columns stays navigable.

import type { ColumnProfile } from "../../lib/profile/types";

export interface Filters {
  /** Matches part of a column's name or output name, ignoring case. */
  query: string;
  /** Only columns that need a look (not ok, including unsupported ones). */
  attentionOnly: boolean;
  /** "all", or one column type. */
  type: string;
}

export const NO_FILTERS: Filters = { query: "", attentionOnly: false, type: "all" };

export const needsAttention = (p: ColumnProfile): boolean => p.status !== "ok";

export function filterProfiles(profiles: readonly ColumnProfile[], f: Filters): ColumnProfile[] {
  const q = f.query.trim().toLowerCase();
  return profiles.filter((p) => {
    if (f.attentionOnly && !needsAttention(p)) return false;
    if (f.type !== "all" && p.type !== f.type) return false;
    if (q === "") return true;
    return p.name.toLowerCase().includes(q) || p.outputName.toLowerCase().includes(q);
  });
}

/** How many columns have each type, for the type filter's labels. */
export function countByType(profiles: readonly ColumnProfile[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of profiles) counts[p.type] = (counts[p.type] ?? 0) + 1;
  return counts;
}

export const isFiltering = (f: Filters): boolean => f.query.trim() !== "" || f.attentionOnly || f.type !== "all";
