// Leave a column out of the fake file, or keep it as an all-missing column so the column list still
// matches the real file (FR-012).

import { useId } from "react";
import type { ColumnProfile, ExcludeMode } from "../../lib/profile/types";

export interface ExcludeControlProps {
  profile: ColumnProfile;
  onChange: (mode: ExcludeMode) => void;
}

export function ExcludeControl({ profile, onChange }: ExcludeControlProps) {
  const id = useId();
  const cannotGenerate = profile.type === "unsupported";
  return (
    <div className="field">
      <label htmlFor={id}>In the fake file</label>
      <select id={id} value={profile.exclude} onChange={(e) => onChange(e.target.value as ExcludeMode)}>
        <option value="include" disabled={cannotGenerate}>
          Include this column
        </option>
        <option value="drop">Leave it out</option>
        <option value="keep_as_na">Keep it, with every value missing</option>
      </select>
      {cannotGenerate && <span className="field-hint">This column cannot be generated in this version.</span>}
    </div>
  );
}
