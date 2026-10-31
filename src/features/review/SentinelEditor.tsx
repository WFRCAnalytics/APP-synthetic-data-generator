// Confirm or edit the sentinel codes (FR-007): values such as -9 or 998 that mean "don't know",
// "refused" or "not applicable". They are kept with their exact counts and left out of the column's
// min, max, mean and spread.

import type { ColumnProfile } from "../../lib/profile/types";
import { parseList } from "../../lib/profile/edits";
import { TextApply } from "./TextApply";

export interface SentinelEditorProps {
  profile: ColumnProfile;
  busy: boolean;
  onApply: (codes: string[] | undefined) => void;
}

export function SentinelEditor({ profile, busy, onApply }: SentinelEditorProps) {
  // Numeric order (-9, 998, 999); object keys would put the whole numbers first and -9 last.
  const current = Object.keys(profile.sentinels).sort((a, b) => (Number.isNaN(Number(a)) || Number.isNaN(Number(b)) ? a.localeCompare(b) : Number(a) - Number(b)));
  return (
    <TextApply
      label="Sentinel codes"
      value={current.join(", ")}
      placeholder="none"
      disabled={busy}
      hint={
        current.length > 0
          ? `Codes found: ${current.map((c) => `${c} (${profile.sentinels[c].toLocaleString("en-US")} rows)`).join(", ")}. Separate codes with commas.`
          : "Codes that mean don't know, refused or not applicable, separated by commas."
      }
      onApply={(text) => onApply(parseList(text))}
      extra={{ label: "Use the proposed codes", onClick: () => onApply(undefined) }}
    />
  );
}
