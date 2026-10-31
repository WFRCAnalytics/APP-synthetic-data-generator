// The optional protections, all off by default (constitution Principle VI, FR-013): merge rare
// categories into "Other", replace labels with neutral codes, and rename the column.

import { useId, useState } from "react";
import { validateOutputName } from "../../lib/protections";
import type { ColumnProfile } from "../../lib/profile/types";
import { TextApply } from "./TextApply";

export interface ProtectionsPanelProps {
  profile: ColumnProfile;
  /** The output names of the other columns, so a rename cannot collide. */
  otherNames: readonly string[];
  onMergeUnderK: (k: number | null) => void;
  onLabelCodes: (on: boolean) => void;
  onRename: (name: string) => void;
}

export function ProtectionsPanel({ profile, otherNames, onMergeUnderK, onLabelCodes, onRename }: ProtectionsPanelProps) {
  const id = useId();
  const categorical = profile.summary.kind === "categorical";
  const [nameText, setNameText] = useState(profile.outputName);
  const nameError = nameText === profile.outputName ? null : validateOutputName(nameText, otherNames);
  const mergeText = profile.mergeUnderK ? String(profile.mergeUnderK) : "";

  return (
    <fieldset className="editor-group">
      <legend>Optional protections (all off by default)</legend>

      {categorical && (
        <>
          <div className="field">
            <label htmlFor={`${id}-merge`}>Merge categories with fewer than this many rows into &ldquo;Other&rdquo;</label>
            <input
              id={`${id}-merge`}
              type="number"
              min={2}
              step={1}
              placeholder="off"
              value={mergeText}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") return onMergeUnderK(null);
                const n = Number(raw);
                if (Number.isInteger(n) && n >= 2) onMergeUnderK(n);
              }}
            />
            <span className="field-hint">Leave blank to keep every label. Rare labels can identify a person.</span>
          </div>

          <div className="field">
            <label htmlFor={`${id}-codes`}>
              <input id={`${id}-codes`} type="checkbox" checked={profile.labelCodes === true} onChange={(e) => onLabelCodes(e.target.checked)} /> Replace labels with neutral codes (cat_01, cat_02, &hellip;)
            </label>
            <span className="field-hint">Analysis code that filters on exact labels will need updating before you switch to the real file.</span>
          </div>
        </>
      )}

      <TextApply
        label="New column name"
        value={profile.outputName}
        error={nameError}
        hint="Renames the column in the fake file only. Code written against it will use the new name."
        onChange={setNameText}
        onApply={(text) => {
          if (validateOutputName(text, otherNames) === null) onRename(text);
        }}
        applyLabel="Rename"
      />
    </fieldset>
  );
}
