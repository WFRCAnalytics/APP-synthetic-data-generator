// Loading a saved spec (FR-004, FR-018): parse, validate, and report problems by column. The messages
// never quote the file's text, so a pasted or hand-edited spec cannot leak a value into an error.

import { validateSpec } from "../../lib/spec/validate";
import type { SpecProblem, SpecResult } from "../../lib/spec/types";

/** A spec bigger than this is not a spec (a real one is a few kilobytes); refuse before reading it. */
export const MAX_SPEC_BYTES = 5 * 1024 * 1024;

export function parseSpecText(text: string): SpecResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, problems: [{ column: null, path: "", message: "This file is not valid JSON, so it cannot be a spec." }] };
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, problems: [{ column: null, path: "", message: "This file is JSON, but not a spec: it should be an object with spec_version and columns." }] };
  }
  return validateSpec(json);
}

export async function readSpecFile(file: File): Promise<SpecResult> {
  if (file.size > MAX_SPEC_BYTES) {
    return { ok: false, problems: [{ column: null, path: "", message: "This file is too large to be a spec. A spec is a few kilobytes." }] };
  }
  return parseSpecText(await file.text());
}

/** Problems grouped for display: general ones first, then one group per column. */
export function groupProblems(problems: readonly SpecProblem[]): { column: string | null; items: SpecProblem[] }[] {
  const groups = new Map<string | null, SpecProblem[]>();
  for (const p of problems) groups.set(p.column, [...(groups.get(p.column) ?? []), p]);
  const general = groups.get(null);
  groups.delete(null);
  return [...(general ? [{ column: null, items: general }] : []), ...[...groups].map(([column, items]) => ({ column, items }))];
}
