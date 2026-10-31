// The problems found in a spec file, by column (FR-018). Messages come from validation and never
// quote the file's own text.

import type { SpecProblem } from "../../lib/spec/types";
import { groupProblems } from "./loadSpec";

export function SpecErrors({ problems }: { problems: readonly SpecProblem[] }) {
  const groups = groupProblems(problems);
  return (
    <div className="banner banner-error" role="alert" data-testid="spec-errors">
      <p>
        <strong>This spec cannot be used.</strong> {problems.length} {problems.length === 1 ? "problem was" : "problems were"} found.
      </p>
      <ul>
        {groups.map((g) => (
          <li key={g.column ?? "(general)"}>
            {g.column === null ? "The file" : <>Column <strong>{g.column}</strong></>}
            <ul>
              {g.items.map((p, i) => (
                <li key={i}>
                  {p.path && p.path !== "(column)" ? <code>{p.path}</code> : null} {p.message}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
