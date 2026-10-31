// Optional protections for category labels (constitution Principle VI; all off by default):
// merge rare categories into "Other", and replace labels with neutral codes. Applied to the label
// counts before generation, so the exact-count rule still holds for what is written.

export interface ProtectionSettings {
  /** Merge categories with fewer than this many rows into "Other". */
  merge_under_k?: number | null;
  /** Replace labels with neutral codes (cat_01, cat_02, ...). */
  label_codes?: boolean;
}

export const OTHER_LABEL = "Other";

/** Labels with counts, after applying whichever protections are on. Input order is kept. */
export function effectiveCounts(counts: Record<string, number>, settings: ProtectionSettings): Record<string, number> {
  let entries = Object.entries(counts);

  const k = settings.merge_under_k;
  if (k !== undefined && k !== null && k > 1) {
    const kept = entries.filter(([, n]) => n >= k);
    const rare = entries.filter(([, n]) => n < k);
    // Merging one rare label would only rename it, so it takes at least two to hide anything.
    if (rare.length >= 2) {
      const merged = rare.reduce((sum, [, n]) => sum + n, 0);
      const existing = kept.findIndex(([label]) => label === OTHER_LABEL);
      if (existing >= 0) kept[existing] = [OTHER_LABEL, kept[existing][1] + merged];
      else kept.push([OTHER_LABEL, merged]);
      entries = kept;
    }
  }

  if (settings.label_codes) {
    const width = Math.max(2, String(entries.length).length);
    entries = entries.map(([, n], i) => [`cat_${String(i + 1).padStart(width, "0")}`, n]);
  }

  return Object.fromEntries(entries);
}

/**
 * Checks a new output name for a column (the rename protection). Returns a plain-language problem,
 * or null when the name is fine. `taken` are the other columns' output names.
 */
export function validateOutputName(candidate: string, taken: readonly string[]): string | null {
  if (candidate.trim() === "") return "A column needs a name.";
  if (/[\r\n]/.test(candidate)) return "A column name cannot contain a line break.";
  if (taken.includes(candidate)) return "Another column already has this name.";
  return null;
}
