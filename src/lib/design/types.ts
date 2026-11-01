// A designed table (specs/006): what a person says about each column in plain terms, with no data
// behind it. A design becomes an ordinary spec (build.ts), so nothing downstream knows it was designed.

import type { PersonalKind } from "../spec/types";

export type DesignKind = "integer" | "decimal" | "category" | "yesno" | "date" | "datetime" | "id" | "personal" | "text";

export interface DesignBase {
  /** Stable key for the list; never written to the spec. */
  id: string;
  name: string;
  /** Share of rows left blank, 0 to 100. */
  missingPct: number;
}

export interface DesignNumber extends DesignBase {
  kind: "integer" | "decimal";
  min: number;
  max: number;
  /** "even": every value in the range is as likely as any other. "bell": values cluster around `typical`. */
  shape: "even" | "bell";
  typical: number;
  spread: number;
  decimals: number;
}

export interface DesignCategory extends DesignBase {
  kind: "category";
  labels: { label: string; weight: number }[];
}

export interface DesignYesNo extends DesignBase {
  kind: "yesno";
  yesPct: number;
  yesLabel: string;
  noLabel: string;
}

/** Dates are year-month-day text, as typed in a date field. */
export interface DesignDate extends DesignBase {
  kind: "date" | "datetime";
  start: string;
  end: string;
  /** A date pattern from the supported set, such as %Y-%m-%d. */
  format: string;
}

export interface DesignId extends DesignBase {
  kind: "id";
  prefix: string;
  digits: number;
}

export interface DesignPersonal extends DesignBase {
  kind: "personal";
  personal: Exclude<PersonalKind, "ssn">;
}

export interface DesignText extends DesignBase {
  kind: "text";
  minLength: number;
  maxLength: number;
}

export type DesignColumn = DesignNumber | DesignCategory | DesignYesNo | DesignDate | DesignId | DesignPersonal | DesignText;

export interface Design {
  /** The file name stem; the spec's source is `<tableName>.csv` and the export `<tableName>_fake.csv`. */
  tableName: string;
  rows: number;
  seed: number;
  columns: DesignColumn[];
}

export interface DesignProblem {
  /** The column's id, or null for the table. */
  columnId: string | null;
  /** Which field, for placing the message next to it. */
  field: string;
  message: string;
}

export const MAX_DESIGN_ROWS = 10_000_000;
export const MAX_DESIGN_COLUMNS = 500;
