// The runs of a pattern: neighbouring positions of the same kind, joined; fixed characters join into the text they spell.

import { isLiteral } from "../../lib/mask/mask";
import type { MaskToken } from "../../lib/profile/types";

export const PATTERN_KINDS: [string, string][] = [
  ["digit", "Digit"],
  ["upper", "Capital letter"],
  ["lower", "Lowercase letter"],
  ["letter", "Any letter"],
  ["alnum", "Letter or digit"],
  ["literal", "Fixed character"],
];

export const kindOf = (t: MaskToken): string => (isLiteral(t) ? "literal" : t);

export interface Run {
  /** The first and last position of the run, counting from 1. */
  from: number;
  to: number;
  kind: string;
  /** For a run of fixed characters: what they spell. */
  text: string;
}

/** Neighbouring positions of the same kind, joined; fixed characters join into the text they spell. */
export function runsOf(tokens: readonly MaskToken[]): Run[] {
  const runs: Run[] = [];
  tokens.forEach((t, i) => {
    const kind = kindOf(t);
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) {
      last.to = i + 1;
      if (isLiteral(t)) last.text += t.literal;
    } else runs.push({ from: i + 1, to: i + 1, kind, text: isLiteral(t) ? t.literal : "" });
  });
  return runs;
}
