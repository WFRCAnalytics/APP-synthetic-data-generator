// Linking a survey ID column to the ID column of another table's spec (specs/019). The link copies what makes the IDs (the
// pattern, the seed, the column's name and how many IDs it makes) and nothing else: no ID value, no other column.

import { idCapacity } from "../mask/mask";
import type { IdLink, SpecFile, SurveyIdColumn } from "../spec/types";

/** The survey ID columns of a spec that can be linked to: written, with their own IDs. */
export function linkableColumns(spec: SpecFile): SurveyIdColumn[] {
  return spec.columns.filter((c): c is SurveyIdColumn => c.type === "survey_id" && (c.exclude ?? "include") === "include" && c.link === undefined);
}

export const groupsOf = (c: Pick<SurveyIdColumn, "repeat_structure">): number => Object.values(c.repeat_structure).reduce((a, b) => a + b, 0);

/** The link to one ID column of another table's spec. */
export function linkTo(spec: SpecFile, column: SurveyIdColumn): IdLink {
  return {
    column: column.name,
    seed: spec.seed,
    mask: column.mask,
    ...(column.min !== undefined ? { min: column.min } : {}),
    ...(column.max !== undefined ? { max: column.max } : {}),
    ...(column.pad_width ? { pad_width: column.pad_width } : {}),
    groups: groupsOf(column),
    table: spec.source.file_name,
  };
}

/** Why a column with this many distinct IDs cannot use that link, or null when it can. */
export function linkProblem(distinct: number, link: IdLink): string | null {
  if (distinct > link.groups) return `This column has ${distinct.toLocaleString("en-US")} distinct IDs but the other table's column makes only ${link.groups.toLocaleString("en-US")}.`;
  if (BigInt(link.groups) > idCapacity(link.mask, link.min, link.max)) return "The other table's pattern cannot hold that many IDs.";
  return null;
}

export const describeLink = (link: IdLink): string => `${link.table ? `${link.table}, ` : ""}column ${link.column} (${link.groups.toLocaleString("en-US")} IDs, seed ${link.seed})`;
