// Whether an ID pattern allows enough distinct IDs for the column (FR-016, FR-017). The repeat
// structure says how many distinct IDs the column needs; the pattern (and a whole-number min and max)
// says how many it allows. A shortfall blocks generation and is explained on Review.

import { groupsNeeded } from "../generate/survey-id";
import { idCapacity, maskCapacity } from "../mask/mask";
import type { ColumnProfile } from "./types";

export interface IdFit {
  allowed: bigint;
  needed: number;
  short: boolean;
}

/** The fit of a survey ID column's pattern, or null when the column is not an ID column. */
export function idFit(p: ColumnProfile): IdFit | null {
  const s = p.summary;
  if (s.kind !== "survey_id") return null;
  const allowed = s.mask.length === 0 ? 0n : idCapacity(s.mask, s.min, s.max);
  const needed = groupsNeeded(s.repeatStructure);
  return { allowed, needed, short: allowed < BigInt(needed) };
}

/**
 * The fit of a short string column: for every length, the pattern's first positions must allow as many
 * distinct values as that length needs. The tightest length is reported.
 */
export function shortStringFit(p: ColumnProfile): IdFit | null {
  const s = p.summary;
  if (s.kind !== "short_string") return null;
  let worst: IdFit = { allowed: 1n << 62n, needed: 0, short: false };
  for (const [length, needed] of Object.entries(s.lengthGroups)) {
    const allowed = maskCapacity(s.pattern.slice(0, Number(length)));
    const short = allowed < BigInt(needed);
    if (short && !worst.short) worst = { allowed, needed, short };
    else if (!worst.short && Number(allowed) - needed < Number(worst.allowed) - worst.needed) worst = { allowed, needed, short };
  }
  return worst;
}

/** The fit of any column whose generated values come from a pattern (survey IDs and short strings). */
export const patternFit = (p: ColumnProfile): IdFit | null => idFit(p) ?? shortStringFit(p);

/** Columns that will be generated but whose pattern is too narrow. */
export function narrowIdColumns(profiles: readonly ColumnProfile[]): ColumnProfile[] {
  return profiles.filter((p) => p.exclude === "include" && patternFit(p)?.short === true);
}

/** "allows 1,000, needs 1,608" for the shortfall message. */
export function shortfallText(fit: IdFit): string {
  return `The pattern allows ${fit.allowed.toLocaleString("en-US")} distinct IDs but the column needs ${fit.needed.toLocaleString("en-US")}.`;
}
