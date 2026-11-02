// The description of a Parquet column that goes into the spec (specs/005 data-model.md, research R4):
// just enough to write the same schema back. It holds a kind, widths, precision, scale, unit and two
// flags, never a value, a range, a statistic or a name from inside the file.

export type ParquetKind = "int" | "float" | "decimal" | "bool" | "string" | "date" | "time" | "timestamp";
export type ParquetUnit = "ms" | "us" | "ns";

export interface ParquetType {
  kind: ParquetKind;
  /** int: 8, 16, 32 or 64. float: 32 or 64. */
  bits?: number;
  /** int only. */
  signed?: boolean;
  /** decimal only, 1 to 38. */
  precision?: number;
  /** decimal only, 0 to precision. */
  scale?: number;
  /** time and timestamp only. */
  unit?: ParquetUnit;
  /** timestamp only: the column was adjusted to UTC (a time-zone-aware column). */
  utc?: boolean;
  /** False when the real column was required (no missing values allowed). */
  nullable: boolean;
}

export type Physical = "BOOLEAN" | "INT32" | "INT64" | "FLOAT" | "DOUBLE" | "BYTE_ARRAY" | "FIXED_LEN_BYTE_ARRAY";

export const PARQUET_KINDS: readonly ParquetKind[] = ["int", "float", "decimal", "bool", "string", "date", "time", "timestamp"];
export const MAX_DECIMAL_PRECISION = 38;

const UNITS: readonly string[] = ["ms", "us", "ns"];

/** Why a column cannot be faked. The texts are fixed and name only the kind (FR-008). */
export type UnsupportedReason = "nested_list" | "nested_struct" | "nested_map" | "nested_union" | "binary" | "uuid" | "interval" | "other" | "nested_object" | "nested_array";

export const UNSUPPORTED_REASONS: readonly UnsupportedReason[] = ["nested_list", "nested_struct", "nested_map", "nested_union", "binary", "uuid", "interval", "other", "nested_object", "nested_array"];

export const UNSUPPORTED_TEXT: Record<UnsupportedReason, string> = {
  nested_list: "A list column. Lists hold real values of unknown shape, so the column is not read or faked.",
  nested_struct: "A struct column. Structs hold real values of unknown shape, so the column is not read or faked.",
  nested_map: "A map column. Maps hold real values of unknown shape, so the column is not read or faked.",
  nested_union: "A union column. Its values are of mixed kinds, so the column is not read or faked.",
  binary: "A binary column. Raw bytes cannot be faked safely, so the column is not read or faked.",
  uuid: "A UUID column. Identifiers of this kind are not faked, so the column is not read or faked.",
  interval: "An interval column. This kind of value is not supported, so the column is not read or faked.",
  other: "A column of a kind this app does not support, so it is not read or faked.",
  nested_object: "An object key. Objects hold real values of unknown shape, so the key is not read or faked.",
  nested_array: "A list key. Lists hold real values of unknown shape, so the key is not read or faked.",
};

const ALLOWED_FIELDS: Record<ParquetKind, readonly string[]> = {
  int: ["kind", "bits", "signed", "nullable"],
  float: ["kind", "bits", "nullable"],
  decimal: ["kind", "precision", "scale", "nullable"],
  bool: ["kind", "nullable"],
  string: ["kind", "nullable"],
  date: ["kind", "nullable"],
  time: ["kind", "unit", "nullable"],
  timestamp: ["kind", "unit", "utc", "nullable"],
};

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** A problem with a type description from a spec, or null when it is valid. */
export function validateParquetType(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "A Parquet type must be an object.";
  const t = value as Record<string, unknown>;
  const kind = t.kind;
  if (typeof kind !== "string" || !PARQUET_KINDS.includes(kind as ParquetKind)) return "The Parquet type kind is not one this app writes.";
  for (const key of Object.keys(t)) if (!ALLOWED_FIELDS[kind as ParquetKind].includes(key)) return `A ${kind} type has no field "${key}".`;
  if (typeof t.nullable !== "boolean") return "A Parquet type needs nullable (true or false).";
  switch (kind as ParquetKind) {
    case "int":
      if (![8, 16, 32, 64].includes(t.bits as number)) return "An int type needs bits of 8, 16, 32 or 64.";
      if (typeof t.signed !== "boolean") return "An int type needs signed (true or false).";
      break;
    case "float":
      if (![32, 64].includes(t.bits as number)) return "A float type needs bits of 32 or 64.";
      break;
    case "decimal":
      if (!isInt(t.precision) || t.precision < 1 || t.precision > MAX_DECIMAL_PRECISION) return `A decimal type needs a precision from 1 to ${MAX_DECIMAL_PRECISION}.`;
      if (!isInt(t.scale) || t.scale < 0 || t.scale > t.precision) return "A decimal type needs a scale from 0 to its precision.";
      break;
    case "time":
      if (typeof t.unit !== "string" || !UNITS.includes(t.unit)) return "A time type needs a unit of ms, us or ns.";
      break;
    case "timestamp":
      if (typeof t.unit !== "string" || !UNITS.includes(t.unit)) return "A timestamp type needs a unit of ms, us or ns.";
      if (typeof t.utc !== "boolean") return "A timestamp type needs utc (true or false).";
      break;
    default:
      break;
  }
  return null;
}

/**
 * Why a column of this profiled type cannot be written with this Parquet type, or null when it can. A column
 * is written from the text the generators make, so a date column fits a date, time, timestamp or string type,
 * a number column an int, float, decimal or string type, and a yes/no column a bool, int or string type.
 */
export function typeConflict(columnType: string, kind: ParquetKind): string | null {
  switch (columnType) {
    case "date":
    case "datetime":
    case "time":
      return kind === "date" || kind === "time" || kind === "timestamp" || kind === "string" ? null : "A date column needs a date, time, timestamp or string Parquet type.";
    case "integer":
    case "float":
      return kind === "int" || kind === "float" || kind === "decimal" || kind === "string" ? null : "A number column needs an int, float, decimal or string Parquet type.";
    case "boolean":
      return kind === "bool" || kind === "string" || kind === "int" ? null : "A yes/no column needs a bool, int or string Parquet type.";
    default:
      return null;
  }
}

/** The smallest number of bytes that holds every decimal of this precision as a two's complement integer. */
export function decimalBytes(precision: number): number {
  const largest = 10n ** BigInt(precision) - 1n;
  let bytes = 1;
  while (largest > 2n ** BigInt(8 * bytes - 1) - 1n) bytes++;
  return bytes;
}

/** The largest unscaled value of a decimal of this precision: 10^precision - 1. */
export const decimalLimit = (precision: number): bigint => 10n ** BigInt(precision) - 1n;

export function intRange(bits: number, signed: boolean): { min: bigint; max: bigint } {
  const b = BigInt(bits);
  return signed ? { min: -(2n ** (b - 1n)), max: 2n ** (b - 1n) - 1n } : { min: 0n, max: 2n ** b - 1n };
}

/** The physical storage a description is written with (research R4). */
export function physicalOf(t: ParquetType): { physical: Physical; typeLength?: number } {
  switch (t.kind) {
    case "int":
      return { physical: (t.bits as number) <= 32 ? "INT32" : "INT64" };
    case "float":
      return { physical: t.bits === 32 ? "FLOAT" : "DOUBLE" };
    case "decimal": {
      const p = t.precision as number;
      if (p <= 9) return { physical: "INT32" };
      if (p <= 18) return { physical: "INT64" };
      return { physical: "FIXED_LEN_BYTE_ARRAY", typeLength: decimalBytes(p) };
    }
    case "bool":
      return { physical: "BOOLEAN" };
    case "string":
      return { physical: "BYTE_ARRAY" };
    case "date":
      return { physical: "INT32" };
    case "time":
      return { physical: t.unit === "ms" ? "INT32" : "INT64" };
    case "timestamp":
      return { physical: "INT64" };
  }
}

/** A short readable name for the UI, such as `int16`, `decimal(10,2)` or `timestamp[us, UTC]`. */
export function describeParquetType(t: ParquetType): string {
  switch (t.kind) {
    case "int":
      return `${t.signed ? "int" : "uint"}${t.bits}`;
    case "float":
      return t.bits === 32 ? "float32" : "float64";
    case "decimal":
      return `decimal(${t.precision},${t.scale})`;
    case "bool":
      return "boolean";
    case "string":
      return "string";
    case "date":
      return "date";
    case "time":
      return `time[${t.unit}]`;
    case "timestamp":
      return `timestamp[${t.unit}${t.utc ? ", UTC" : ""}]`;
  }
}

/** The number of units in a second, for converting to and from the epoch. */
export const UNITS_PER_SECOND: Record<ParquetUnit, bigint> = { ms: 1000n, us: 1_000_000n, ns: 1_000_000_000n };
