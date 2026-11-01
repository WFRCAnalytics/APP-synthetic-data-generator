// The column a person gets when they add one of each kind: it works as it is, so a table can be
// designed by changing only what matters.

import type { Design, DesignColumn, DesignKind } from "./types";

export const KIND_LABELS: Record<DesignKind, string> = {
  integer: "Whole number",
  decimal: "Decimal number",
  category: "Category",
  yesno: "Yes or no",
  date: "Date",
  datetime: "Date and time",
  id: "ID",
  personal: "Personal detail",
  text: "Free text",
};

/** One line that says what each kind is for, shown where the kind is chosen. */
export const KIND_HINTS: Record<DesignKind, string> = {
  integer: "Counts, ages, years: 0, 1, 2, ...",
  decimal: "Amounts, distances, rates: 12.5, 3.14, ...",
  category: "A fixed set of labels, such as a travel mode",
  yesno: "Two labels, with a chance of the first",
  date: "A day between two dates",
  datetime: "A moment between two dates",
  id: "A code that is different on every row, such as P0001",
  personal: "Invented names, emails, phone numbers or addresses",
  text: "Sentences of a chosen length",
};

export const KIND_ORDER: readonly DesignKind[] = ["integer", "decimal", "category", "yesno", "date", "datetime", "id", "personal", "text"];

let counter = 0;
export const newColumnId = (): string => `c${Date.now().toString(36)}${(counter++).toString(36)}`;

const BASE_NAMES: Record<DesignKind, string> = {
  integer: "count",
  decimal: "amount",
  category: "category",
  yesno: "flag",
  date: "date",
  datetime: "timestamp",
  id: "id",
  personal: "name",
  text: "notes",
};

/** A name not used yet: `count`, then `count_2`, `count_3`, and so on. */
export function uniqueName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}_${i}`.toLowerCase())) return `${base}_${i}`;
}

/** The column type of one kind, so a caller can edit its fields without a cast. */
export type ColumnOf<K extends DesignKind> = DesignColumn extends infer U ? (U extends { kind: infer UK } ? (K extends UK ? U : never) : never) : never;

export function defaultColumn<K extends DesignKind>(kind: K, taken: readonly string[] = []): ColumnOf<K> {
  return makeColumn(kind, taken) as ColumnOf<K>;
}

function makeColumn(kind: DesignKind, taken: readonly string[]): DesignColumn {
  const base = { id: newColumnId(), name: uniqueName(BASE_NAMES[kind], taken), missingPct: 0 };
  switch (kind) {
    case "integer":
      return { ...base, kind, min: 0, max: 100, shape: "even", typical: 50, spread: 15, decimals: 0 };
    case "decimal":
      return { ...base, kind, min: 0, max: 100, shape: "even", typical: 50, spread: 15, decimals: 2 };
    case "category":
      return { ...base, kind, labels: [{ label: "A", weight: 50 }, { label: "B", weight: 30 }, { label: "C", weight: 20 }] };
    case "yesno":
      return { ...base, kind, yesPct: 50, yesLabel: "Yes", noLabel: "No" };
    case "date":
      return { ...base, kind, start: "2020-01-01", end: "2024-12-31", format: "%Y-%m-%d" };
    case "datetime":
      return { ...base, kind, start: "2020-01-01", end: "2024-12-31", format: "%Y-%m-%d %H:%M:%S" };
    case "id":
      return { ...base, kind, prefix: "P", digits: 6 };
    case "personal":
      return { ...base, kind, personal: "full_name" };
    case "text":
      return { ...base, kind, minLength: 20, maxLength: 120 };
  }
}

export const DATE_FORMATS: readonly { value: string; label: string }[] = [
  { value: "%Y-%m-%d", label: "2024-03-31" },
  { value: "%m/%d/%Y", label: "03/31/2024" },
  { value: "%d/%m/%Y", label: "31/03/2024" },
];

export const DATETIME_FORMATS: readonly { value: string; label: string }[] = [
  { value: "%Y-%m-%d %H:%M:%S", label: "2024-03-31 14:05:09" },
  { value: "%m/%d/%Y %H:%M:%S", label: "03/31/2024 14:05:09" },
];

export const emptyDesign = (): Design => ({ tableName: "my_table", rows: 1000, seed: 42, columns: [] });
