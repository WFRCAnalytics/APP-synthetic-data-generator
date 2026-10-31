// Whether a number format code suits a column (specs/003 FR-006). Mirrors the spec check, so the editor
// refuses what a saved spec would be refused for.

import type { ColumnProfile } from "../../lib/profile/types";
import { describeFormat } from "../../lib/xlsx/formats";

const hasControlCharacter = (text: string) => Array.from(text).some((ch) => ch.charCodeAt(0) < 32);

/** Why a format code does not suit a column of this type, or null. */
export function cellFormatProblem(profile: ColumnProfile, code: string): string | null {
  const text = code.trim();
  if (text === "") return "Enter a format code, such as #,##0.00.";
  if (hasControlCharacter(text) || text.length > 200) return "That is not a number format code.";
  if (profile.storedAsText) return null;
  const kind = describeFormat(text).kind;
  const temporal = kind === "date" || kind === "time" || kind === "datetime";
  if (profile.type === "date" || profile.type === "datetime" || profile.type === "time") return temporal ? null : "A date column needs a date or time format.";
  if (profile.type === "integer" || profile.type === "float") return temporal || kind === "text" ? "A number column needs a number, percent, currency or scientific format." : null;
  return temporal && profile.type !== "categorical" && profile.type !== "boolean" ? "A date or time format does not suit this column." : null;
}
