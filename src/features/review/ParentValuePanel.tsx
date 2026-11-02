// Making a category column take its value from the other table's row with the same ID (specs/030): the person chooses the other
// table's saved spec and which of its categories to follow. Only that column's labels, counts and the seed are copied.

import { useState } from "react";
import { InfoTip } from "../../components/InfoTip";
import { parentColumnsOf, parentValueFrom } from "../../lib/ids/link";
import type { LocalEdits } from "../../lib/profile/edits";
import type { ColumnProfile } from "../../lib/profile/types";
import type { SpecFile } from "../../lib/spec/types";
import { readSpecFile } from "../spec/loadSpec";
import type { TableInfo } from "./ChildCountPanel";

export interface ParentValuePanelProps {
  profile: ColumnProfile;
  table: TableInfo;
  onEdit: (patch: LocalEdits) => void;
}

export function ParentValuePanel({ profile, table, onEdit }: ParentValuePanelProps) {
  const [other, setOther] = useState<SpecFile | null>(null);
  const [choice, setChoice] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  if (profile.summary.kind !== "categorical") return null;
  if (profile.naCount > 0 || Object.keys(profile.sentinels).length > 0) return null; // the value comes whole from the other table
  const linked = table.linkedIds ?? [];
  if (linked.length === 0 && !profile.fromParent) return null;

  /** The columns of the other table this table's linked ID columns can reach. */
  const candidates = other
    ? linked.flatMap((l) => parentColumnsOf(other, l.link).map((column) => ({ via: l.name, link: l.link, column })))
    : [];

  const choose = async (file: File | undefined) => {
    setProblem(null);
    setOther(null);
    if (!file) return;
    const result = await readSpecFile(file);
    if (!result.ok) return setProblem("That file is not a valid spec.");
    const found = linked.flatMap((l) => parentColumnsOf(result.spec, l.link));
    if (found.length === 0) return setProblem("No category column of that spec can be followed: this table needs an ID column that uses its IDs, with one new ID per row.");
    setOther(result.spec);
    setChoice(found[0].name);
  };

  const use = () => {
    const picked = candidates.find((c) => c.column.name === choice);
    if (!other || !picked) return;
    setProblem(null);
    setOther(null);
    onEdit({ fromParent: parentValueFrom(other, picked.column, picked.via, picked.link) });
  };

  return (
    <div className="field" data-testid="parent-value">
      <span className="label-row">
        <label htmlFor={`parent-value-${profile.name}`}>Value from another table</label>
        <InfoTip label="About taking a value from another table">
          Make this column, in each row, the value the other table has in the row with the same ID, such as a person&apos;s zone from their
          household. Choose the saved spec of the other table. This table needs an ID column that uses that table&apos;s IDs. The column then
          replaces its own summary; the check table says whether every value is one of the other table&apos;s.
        </InfoTip>
      </span>
      {profile.fromParent ? (
        <div className="inline-row">
          <span data-testid="parent-value-summary">
            Takes the value of {profile.fromParent.parent.column} in {profile.fromParent.parent.table ?? "the other table"}, through {profile.fromParent.via}.
          </span>
          <button type="button" className="button button-secondary" onClick={() => onEdit({ fromParent: null })}>
            Use its own summary instead
          </button>
        </div>
      ) : (
        <>
          <input id={`parent-value-${profile.name}`} type="file" accept=".json,application/json" aria-label="Spec of the table to take the value from" onChange={(e) => void choose(e.target.files?.[0])} />
          {other && candidates.length > 0 && (
            <div className="inline-row">
              <select value={choice} aria-label="Column of the other table" onChange={(e) => setChoice(e.target.value)}>
                {candidates.map((c) => (
                  <option key={`${c.via}-${c.column.name}`} value={c.column.name}>
                    {c.column.name}
                  </option>
                ))}
              </select>
              <button type="button" className="button button-secondary" onClick={use}>
                Take its value
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
