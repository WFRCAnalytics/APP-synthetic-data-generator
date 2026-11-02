// Using the IDs of another table's column (specs/019): the person chooses the other table's saved spec and one of its ID
// columns. Only the pattern, seed and column name are copied; no ID value is read or shown.

import { useState } from "react";
import { InfoTip } from "../../components/InfoTip";
import { describeLink, linkProblem, linkTo, linkableColumns } from "../../lib/ids/link";
import type { LocalEdits } from "../../lib/profile/edits";
import type { ColumnProfile } from "../../lib/profile/types";
import type { SpecFile } from "../../lib/spec/types";
import { readSpecFile } from "../spec/loadSpec";

export interface IdLinkPanelProps {
  profile: ColumnProfile;
  onEdit: (patch: LocalEdits) => void;
}

export function IdLinkPanel({ profile, onEdit }: IdLinkPanelProps) {
  const [other, setOther] = useState<SpecFile | null>(null);
  const [choice, setChoice] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  if (profile.summary.kind !== "survey_id") return null;
  const distinct = profile.summary.distinct;
  const columns = other ? linkableColumns(other) : [];

  const choose = async (file: File | undefined) => {
    setProblem(null);
    setOther(null);
    if (!file) return;
    const result = await readSpecFile(file);
    if (!result.ok) return setProblem("That file is not a valid spec.");
    const found = linkableColumns(result.spec);
    if (found.length === 0) return setProblem("That spec has no ID column to use.");
    setOther(result.spec);
    setChoice(found[0].name);
  };

  const use = () => {
    const column = columns.find((c) => c.name === choice);
    if (!other || !column) return;
    const link = linkTo(other, column);
    const why = linkProblem(distinct, link);
    if (why) return setProblem(why);
    setProblem(null);
    setOther(null);
    onEdit({ idLink: link });
  };

  return (
    <div className="field" data-testid="id-link">
      <span className="label-row">
        <label htmlFor={`id-link-${profile.name}`}>IDs from another table</label>
        <InfoTip label="About linked IDs">
          Choose the saved spec of another table and one of its ID columns. This column then uses only IDs that table makes, so a join
          between the two fake tables finds every row. Generate the other table from the same spec, with the seed saved in it.
        </InfoTip>
      </span>
      {profile.idLink ? (
        <div className="inline-row">
          <span data-testid="id-link-summary">Uses the IDs of {describeLink(profile.idLink)}.</span>
          <button type="button" className="button button-secondary" onClick={() => onEdit({ idLink: null })}>
            Make new IDs instead
          </button>
        </div>
      ) : (
        <>
          <input id={`id-link-${profile.name}`} type="file" accept=".json,application/json" aria-label="Spec of the other table" onChange={(e) => void choose(e.target.files?.[0])} />
          {other && columns.length > 0 && (
            <div className="inline-row">
              <select value={choice} aria-label="ID column of the other table" onChange={(e) => setChoice(e.target.value)}>
                {columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button type="button" className="button button-secondary" onClick={use}>
                Use these IDs
              </button>
            </div>
          )}
        </>
      )}
      {problem && (
        <p className="field-hint" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
