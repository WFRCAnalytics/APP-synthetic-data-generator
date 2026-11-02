// Linking a survey ID column to the ID column of another table's spec (specs/019). The link copies what makes the IDs (the
// pattern, the seed, the column's name and how many IDs it makes) and nothing else: no ID value, no other column.

import { idCapacity } from "../mask/mask";
import { FOLLOWABLE_TYPES, type ChildCount, type ColumnSpec, type IdLink, type ParentValue, type SpecFile, type SurveyIdColumn } from "../spec/types";

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

/** The ID columns of the other table that use the IDs of this table's column, with the problem when one cannot be counted. */
export function childColumnsOf(child: SpecFile, table: { seed: number; rows: number; idColumns: string[] }): { column: SurveyIdColumn; problem: string | null }[] {
  return child.columns
    .filter((c): c is SurveyIdColumn => c.type === "survey_id" && c.link !== undefined && table.idColumns.includes(c.link.column))
    .map((column) => ({ column, problem: childCountProblem(column, table) }));
}

/** Why a child's ID column cannot be counted by this table, or null when it can. */
export function childCountProblem(child: SurveyIdColumn, table: { rows: number }): string | null {
  const link = child.link;
  if (!link) return "That column does not use another table's IDs.";
  if (link.groups !== table.rows) return `That table draws from ${link.groups.toLocaleString("en-US")} IDs but this table has ${table.rows.toLocaleString("en-US")} rows.`;
  return null;
}

/** What a whole-number column needs to count the rows another table has for each ID of this one. */
export function childCountFrom(child: SpecFile, column: SurveyIdColumn): ChildCount | null {
  const link = column.link;
  if (!link) return null;
  return { column: link.column, child: { table: child.source.file_name, column: column.name, seed: child.seed, repeat_structure: { ...column.repeat_structure }, groups: link.groups } };
}

export const describeLink = (link: IdLink): string => `${link.table ? `${link.table}, ` : ""}column ${link.column} (${link.groups.toLocaleString("en-US")} IDs, seed ${link.seed})`;

/**
 * The columns of a table whose value another table can take (specs/030): written, not counting rows of a third table and not changed by
 * a rule. `type` narrows them to the kind of column that would follow.
 */
export function parentColumnsOf(spec: SpecFile, link: IdLink, type?: string): ColumnSpec[] {
  const id = spec.columns.find((c): c is SurveyIdColumn => c.type === "survey_id" && c.name === link.column);
  const once = id !== undefined && id.link === undefined && Object.keys(id.repeat_structure).length === 1 && id.repeat_structure["1"] === spec.n_rows && !id.na && !id.sentinels;
  if (!once || spec.seed !== link.seed || link.groups !== spec.n_rows) return [];
  const ruled = new Set((spec.rules ?? []).map((r) => r.column));
  return spec.columns.filter(
    (c) =>
      FOLLOWABLE_TYPES.has(c.type) &&
      (type === undefined || c.type === type) &&
      (c.exclude ?? "include") === "include" &&
      !ruled.has(c.name) &&
      !((c.type === "integer" || c.type === "float") && c.child_count),
  );
}

/**
 * What a column needs to take the value another table's column has in the row with the same ID: that column's own spec and the seed,
 * and, when it takes its own value from a third table, the ID column it does so through (the chain goes on as far as it goes).
 */
export function parentValueFrom(spec: SpecFile, column: ColumnSpec, via: string, link: IdLink): ParentValue {
  const viaColumn = column.from_parent ? spec.columns.find((c): c is SurveyIdColumn => c.type === "survey_id" && c.name === column.from_parent?.via) : undefined;
  // What the other table's generator needs; a name, label or note for people stays behind.
  const { output_name: _o, description: _d, value_labels: _v, exclude: _e, quoted: _q, ...own } = column;
  void [_o, _d, _v, _e, _q];
  return {
    via,
    parent: {
      table: spec.source.file_name,
      column: column.name,
      id_column: link.column,
      seed: spec.seed,
      rows: spec.n_rows,
      spec: own as ColumnSpec,
      ...(viaColumn ? { via_column: viaColumn } : {}),
    },
  };
}
