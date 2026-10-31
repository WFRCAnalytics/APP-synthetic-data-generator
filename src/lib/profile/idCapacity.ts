// Whether an ID pattern allows enough distinct IDs for the column (FR-016, FR-017). The repeat
// structure says how many distinct IDs the column needs; the pattern (and a whole-number min and max)
// says how many it allows. A shortfall blocks generation and is explained on Review.

import { groupsNeeded } from "../generate/survey-id";
import { idCapacity } from "../mask/mask";
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

/** Columns that will be generated but whose pattern is too narrow. */
export function narrowIdColumns(profiles: readonly ColumnProfile[]): ColumnProfile[] {
  return profiles.filter((p) => p.exclude === "include" && idFit(p)?.short === true);
}

/** "allows 1,000, needs 1,608" for the shortfall message. */
export function shortfallText(fit: IdFit): string {
  return `The pattern allows ${fit.allowed.toLocaleString("en-US")} distinct IDs but the column needs ${fit.needed.toLocaleString("en-US")}.`;
}
