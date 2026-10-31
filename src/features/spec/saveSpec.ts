// Saving the spec (FR-017, FR-018): one small JSON file that is the only thing derived from the real
// data. The text is the spec exactly as built, indented so a person can read it end to end.

import type { SpecFile } from "../../lib/spec/types";

export const specToJson = (spec: SpecFile): string => JSON.stringify(spec, null, 2) + "\n";

export const specBlobOf = (spec: SpecFile): Blob => new Blob([specToJson(spec)], { type: "application/json" });

/** "trips.csv" becomes "trips_spec.json". */
export function specFileNameFor(sourceFileName: string): string {
  const base = sourceFileName.replace(/\.[^.]*$/, "") || "table";
  return `${base}_spec.json`;
}
