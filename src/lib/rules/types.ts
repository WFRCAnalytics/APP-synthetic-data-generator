// Rules between columns (specs/015): relations the person states, never learned from the data. A rule changes one column (its
// target) using another (its source) in the same row. They are kept in the spec as plain statements.

/** The target comes after its source by a number of days (dates), seconds (dates and times) or units (numbers). */
export interface FollowsRule {
  kind: "follows";
  column: string;
  after: string;
  /** The smallest and largest gap, in whole units of the column. */
  min: number;
  max: number;
}

/** The target is blank in every row where its source is blank. */
export interface BlankWithRule {
  kind: "blank_with";
  column: string;
  with: string;
}

/** In every row where the source is a value, the target is another value. */
export interface SetWhenRule {
  kind: "set_when";
  column: string;
  when_column: string;
  when_value: string;
  value: string;
}

export type RuleSpec = FollowsRule | BlankWithRule | SetWhenRule;

export const MAX_RULES = 100;

export const RULE_KINDS: readonly { value: RuleSpec["kind"]; label: string }[] = [
  { value: "follows", label: "Comes after another column" },
  { value: "blank_with", label: "Is blank when another column is blank" },
  { value: "set_when", label: "Has a set value when another column has a value" },
];

/** The source column of a rule. */
export const sourceOf = (r: RuleSpec): string =>
  r.kind === "follows" ? r.after : r.kind === "blank_with" ? r.with : r.when_column;

/** A plain sentence for a rule, used on Review and in the README. */
export function describeRule(r: RuleSpec): string {
  switch (r.kind) {
    case "follows":
      return `${r.column} comes ${r.min === r.max ? r.min : `${r.min} to ${r.max}`} after ${r.after}`;
    case "blank_with":
      return `${r.column} is blank when ${r.with} is blank`;
    case "set_when":
      return `${r.column} is ${r.value} when ${r.when_column} is ${r.when_value}`;
  }
}
