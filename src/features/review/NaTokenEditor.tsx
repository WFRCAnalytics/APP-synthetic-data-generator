// Confirm or edit which tokens mean "missing" (FR-008). A blank field always does; this lists the
// others (NA, N/A, a dot, "refused"), so the fake file uses the same ones.

import type { ColumnProfile } from "../../lib/profile/types";
import { EMPTY_TEXT_TOKEN } from "../../lib/spec/types";
import { parseList } from "../../lib/profile/edits";
import { TextApply } from "./TextApply";

export interface NaTokenEditorProps {
  profile: ColumnProfile;
  busy: boolean;
  onApply: (tokens: string[]) => void;
}

/** What the box shows for the token that stands for a cell holding empty text (an Excel quirk). */
const EMPTY_TEXT_WORD = "(empty text)";

export function NaTokenEditor({ profile, busy, onApply }: NaTokenEditorProps) {
  // The blank field is always missing, so it is not listed here. Empty text in a workbook cell is
  // not a blank cell, so it has its own marker, shown as a word.
  const current = profile.naTokens.filter((t) => t !== "").map((t) => (t === EMPTY_TEXT_TOKEN ? EMPTY_TEXT_WORD : t));
  return (
    <TextApply
      label="Missing-value markers"
      value={current.join(", ")}
      placeholder="none besides blank"
      disabled={busy}
      hint={`Blank fields always count as missing (${(profile.naByToken[""] ?? 0).toLocaleString("en-US")} here). Add others, such as NA or refused, separated by commas.`}
      onApply={(text) => onApply(parseList(text).map((t) => (t === EMPTY_TEXT_WORD ? EMPTY_TEXT_TOKEN : t)))}
    />
  );
}
