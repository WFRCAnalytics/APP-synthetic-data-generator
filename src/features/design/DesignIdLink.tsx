// A designed ID column that uses the IDs of another table's ID column (specs/027): the person chooses the other table's saved spec
// and one of its ID columns, then says how many rows share one ID. Only the pattern, seed and column name are copied.

import { useState } from "react";
import { InfoTip } from "../../components/InfoTip";
import { describeLink, linkTo, linkableColumns } from "../../lib/ids/link";
import type { DesignId, DesignProblem } from "../../lib/design/types";
import type { SpecFile } from "../../lib/spec/types";
import { readSpecFile } from "../spec/loadSpec";
import { NumberField } from "./fields";

export interface DesignIdLinkProps {
  c: DesignId;
  onChange: (c: DesignId) => void;
  /** Problems of one field, shown beside it. */
  problems: (field: string) => DesignProblem[];
}

export function DesignIdLink({ c, onChange, problems }: DesignIdLinkProps) {
  const [other, setOther] = useState<SpecFile | null>(null);
  const [choice, setChoice] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
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
    const column = columns.find((x) => x.name === choice);
    if (!other || !column) return;
    setProblem(null);
    setOther(null);
    onChange({ ...c, link: linkTo(other, column) });
  };

  return (
    <div className="field" data-testid="design-id-link">
      <span className="label-row">
        <label htmlFor={`design-id-link-${c.id}`}>IDs from another table</label>
        <InfoTip label="About linked IDs">
          Choose the saved spec of another table and one of its ID columns. This column then uses only IDs that table makes, so a join
          between the two fake tables finds every row. Generate the other table from the same spec, with the seed saved in it.
        </InfoTip>
      </span>
      {c.link ? (
        <>
          <div className="inline-row">
            <span data-testid="design-id-link-summary">Uses the IDs of {describeLink(c.link)}.</span>
            <button type="button" className="button button-secondary" onClick={() => onChange({ ...c, link: undefined })}>
              Make new IDs instead
            </button>
          </div>
          <div className="design-row">
            <NumberField label="Fewest rows per ID" value={c.perIdMin} onChange={(perIdMin) => onChange({ ...c, perIdMin })} problems={problems("perIdMin")} />
            <NumberField label="Most rows per ID" value={c.perIdMax} onChange={(perIdMax) => onChange({ ...c, perIdMax })} problems={problems("perIdMax")} />
          </div>
        </>
      ) : (
        <>
          <input id={`design-id-link-${c.id}`} type="file" accept=".json,application/json" aria-label="Spec of the other table" onChange={(e) => void choose(e.target.files?.[0])} />
          {other && columns.length > 0 && (
            <div className="inline-row">
              <select value={choice} aria-label="ID column of the other table" onChange={(e) => setChoice(e.target.value)}>
                {columns.map((x) => (
                  <option key={x.name} value={x.name}>
                    {x.name}
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
