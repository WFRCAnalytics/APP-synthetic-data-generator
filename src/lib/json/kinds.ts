// From the engine's per-key type counts to a key's kind (specs/007 research R3). The counts are numbers the
// engine returns about structure (how many records hold a type for the key); no value is involved.

import type { JsonKind } from "./types";

/** How many records hold each engine type name for one key, plus how many records there are. */
export interface KeyCounts {
  /** Engine type name (`UBIGINT`, `DOUBLE`, `VARCHAR`, `BOOLEAN`, `NULL`, `ARRAY`, `OBJECT`, ...) to a count of records. */
  types: Record<string, number>;
  /** Records in the file. */
  records: number;
}

export interface KeyDescription {
  kind: JsonKind;
  /** Records where the key is present and null. */
  nulls: number;
  /** Records without the key. */
  missing: number;
  /** The key held kinds that cannot be one (numbers and text, say); it is read as text. */
  mixed: boolean;
}

const NUMBER_TYPES = new Set(["TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "UTINYINT", "USMALLINT", "UINTEGER", "UBIGINT", "UHUGEINT", "FLOAT", "DOUBLE", "DECIMAL"]);

export function describeKey({ types, records }: KeyCounts): KeyDescription {
  let present = 0;
  let nulls = 0;
  let numbers = 0;
  let strings = 0;
  let booleans = 0;
  let objects = 0;
  let arrays = 0;
  for (const [name, count] of Object.entries(types)) {
    present += count;
    if (name === "NULL") nulls += count;
    else if (NUMBER_TYPES.has(name)) numbers += count;
    else if (name === "VARCHAR") strings += count;
    else if (name === "BOOLEAN") booleans += count;
    else if (name === "OBJECT") objects += count;
    else if (name === "ARRAY") arrays += count;
    else strings += count; // an unknown type is read as text
  }
  const missing = Math.max(0, records - present);

  // A nested value anywhere makes the key unsupported, whatever else it holds.
  if (objects > 0) return { kind: "object", nulls, missing, mixed: false };
  if (arrays > 0) return { kind: "array", nulls, missing, mixed: false };

  const kinds = [numbers, strings, booleans].filter((n) => n > 0).length;
  if (kinds === 0) return { kind: "null", nulls, missing, mixed: false };
  if (kinds > 1) return { kind: "string", nulls, missing, mixed: true };
  return { kind: numbers > 0 ? "number" : booleans > 0 ? "boolean" : "string", nulls, missing, mixed: false };
}
