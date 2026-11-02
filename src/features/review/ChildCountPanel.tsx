// Making a whole-number column the number of rows another table has for each ID (specs/026): the person chooses the other table's
// saved spec and which of its ID columns uses this table's IDs. Only the other table's repeat structure and seed are copied.

import { useState } from "react";
import { InfoTip } from "../../components/InfoTip";
import { childColumnsOf, childCountFrom } from "../../lib/ids/link";
import type { LocalEdits } from "../../lib/profile/edits";
import type { ColumnProfile } from "../../lib/profile/types";
import type { IdLink, SpecFile } from "../../lib/spec/types";
import { readSpecFile } from "../spec/loadSpec";

/** What this table is, so a table that uses its IDs can be matched to it. */
export interface TableInfo {
  seed: number;
  rows: number;
  /** ID columns that hold one new ID per row, none missing. */
  idColumns: string[];
  /** ID columns of this table that use another table's IDs, none missing: a category can follow the other table's through them. */
  linkedIds?: { name: string; link: IdLink }[];
  /** Changes the seed of this table: the other table was linked to IDs made with one seed, and the counts only match when this one is made with it. */
  setSeed?: (seed: number) => void;
}

export interface ChildCountPanelProps {
  profile: ColumnProfile;
  table: TableInfo;
  onEdit: (patch: LocalEdits) => void;
}

export function ChildCountPanel({ profile, table, onEdit }: ChildCountPanelProps) {
  const [other, setOther] = useState<SpecFile | null>(null);
  const [choice, setChoice] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (profile.summary.kind !== "numeric" || profile.type !== "integer") return null;
  if (profile.naCount > 0 || Object.keys(profile.sentinels).length > 0) return null; // a count has no missing values
  if (table.idColumns.length === 0 && !profile.childCount) return null;
  const candidates = other ? childColumnsOf(other, table) : [];

  const choose = async (file: File | undefined) => {
    setProblem(null);
    setOther(null);
    if (!file) return;
    const result = await readSpecFile(file);
    if (!result.ok) return setProblem("That file is not a valid spec.");
    const found = childColumnsOf(result.spec, table);
    if (found.length === 0) return setProblem("No ID column of that spec uses the IDs of this table.");
    setOther(result.spec);
    setChoice(found[0].column.name);
  };

  const use = () => {
    const picked = candidates.find((c) => c.column.name === choice);
    if (!other || !picked) return;
    if (picked.problem) return setProblem(picked.problem);
    const count = picked.column.link && childCountFrom(other, picked.column);
    if (!count) return;
    setProblem(null);
    setOther(null);
    const needed = picked.column.link?.seed;
    if (needed !== undefined && needed !== table.seed && table.setSeed) {
      table.setSeed(needed);
      setNote(`This table's seed is now ${needed}, the seed the other table was linked to, so the two tables agree.`);
    }
    onEdit({ childCount: count });
  };

  return (
    <div className="field" data-testid="child-count">
      <span className="label-row">
        <label htmlFor={`child-count-${profile.name}`}>Number of rows in another table</label>
        <InfoTip label="About counting another table's rows">
          Make this column, for each ID, the number of rows another table has for that ID, such as a household&apos;s size from the persons
          table. Choose the saved spec of the other table, which must use this table&apos;s IDs. This column then replaces its own summary;
          the check table says whether the counts add up to the other table&apos;s rows.
        </InfoTip>
      </span>
      {profile.childCount ? (
        <div className="inline-row">
          <span data-testid="child-count-summary">
            Counts the rows of {profile.childCount.child.table ?? "the other table"}, column {profile.childCount.child.column}.
          </span>
          <button type="button" className="button button-secondary" onClick={() => onEdit({ childCount: null })}>
            Use its own summary instead
          </button>
        </div>
      ) : (
        <>
          <input id={`child-count-${profile.name}`} type="file" accept=".json,application/json" aria-label="Spec of the other table" onChange={(e) => void choose(e.target.files?.[0])} />
          {other && candidates.length > 0 && (
            <div className="inline-row">
              <select value={choice} aria-label="ID column of the other table" onChange={(e) => setChoice(e.target.value)}>
                {candidates.map((c) => (
                  <option key={c.column.name} value={c.column.name}>
                    {c.column.name}
                  </option>
                ))}
              </select>
              <button type="button" className="button button-secondary" onClick={use}>
                Count its rows
              </button>
            </div>
          )}
        </>
      )}
      {note && (
        <p className="field-hint" role="status" data-testid="child-count-note">
          {note}
        </p>
      )}
      {problem && (
        <p className="field-hint" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
