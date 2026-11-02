// A pattern shown as runs, not as one tile per character: eleven "Letter or digit" positions in a row read as one line, "Positions 7 to 17,
// Letter or digit, 11 positions". Changing a run's kind changes every position in it; the length of the pattern never changes. For one
// position at a time the caller offers the full list under "Edit each position".

import type { MaskToken } from "../../lib/profile/types";
import { PATTERN_KINDS, runsOf, type Run } from "./runLogic";
import "./PatternRuns.css";

const where = (r: Run): string => (r.from === r.to ? `Position ${r.from}` : `Positions ${r.from} to ${r.to}`);

export interface PatternRunsProps {
  tokens: readonly MaskToken[];
  onChange: (next: MaskToken[]) => void;
}

export function PatternRuns({ tokens, onChange }: PatternRunsProps) {
  const runs = runsOf(tokens);

  const setRunKind = (r: Run, kind: string) => {
    const next = [...tokens];
    for (let p = r.from - 1; p < r.to; p++) next[p] = kind === "literal" ? { literal: "-" } : (kind as MaskToken);
    onChange(next);
  };

  return (
    <ol className="pattern-runs" data-testid="pattern-runs">
      {runs.map((r) => {
        const count = r.to - r.from + 1;
        return (
          <li key={r.from} className="pattern-run">
            <span className="pattern-run-where" title={where(r)}>
              {r.from === r.to ? r.from : `${r.from}–${r.to}`}
            </span>
            <select aria-label={`Kind of ${where(r).toLowerCase()}`} value={r.kind} onChange={(e) => setRunKind(r, e.target.value)}>
              {PATTERN_KINDS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {r.kind === "literal" ? (
              count === 1 ? (
                <input
                  aria-label={`Fixed character at position ${r.from}`}
                  className="id-mask-literal"
                  value={r.text}
                  onChange={(e) => {
                    const ch = Array.from(e.target.value).slice(-1)[0];
                    if (ch === undefined) return;
                    const next = [...tokens];
                    next[r.from - 1] = { literal: ch };
                    onChange(next);
                  }}
                />
              ) : (
                <span className="pattern-run-text" title="Change single characters under Edit each position">
                  &ldquo;{r.text}&rdquo;
                </span>
              )
            ) : (
              <span className="pattern-run-count" title={count === 1 ? "1 position" : `${count} positions`}>
                &times;{count}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
