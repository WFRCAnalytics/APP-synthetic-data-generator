// From what the engine says about a Parquet file's columns to a `ParquetType` or an unsupported reason
// (specs/005 research R2, R4). The input is structure only: the engine's type text for each column and the
// rows of `parquet_schema`. The raw logical-type text is read for its unit and zone flag and then dropped;
// nothing from it is kept.

import type { ParquetType, ParquetUnit, UnsupportedReason } from "./types";

/** The columns of a `parquet_schema(file)` row that are used. */
export interface SchemaRow {
  name: string;
  type: string | null;
  converted_type: string | null;
  logical_type: string | null;
  type_length: number | null;
  scale: number | null;
  precision: number | null;
  repetition_type: string | null;
  num_children: number | null;
}

export type ColumnMapping = { ok: true; type: ParquetType } | { ok: false; reason: UnsupportedReason };

/**
 * The schema row of each top-level column, in file order. `parquet_schema` lists the tree depth first,
 * starting with the root; a nested column is followed by its descendants, which are skipped here.
 */
export function topLevelRows(rows: readonly SchemaRow[]): SchemaRow[] {
  if (rows.length === 0) return [];
  const out: SchemaRow[] = [];
  let at = 1;
  const skipSubtree = (index: number): number => {
    let next = index + 1;
    for (let c = 0; c < (rows[index].num_children ?? 0); c++) next = skipSubtree(next);
    return next;
  };
  for (let c = 0; c < (rows[0].num_children ?? 0) && at < rows.length; c++) {
    out.push(rows[at]);
    at = skipSubtree(at);
  }
  return out;
}

function unitOf(logical: string | null): ParquetUnit | null {
  if (!logical) return null;
  if (/MILLIS=MilliSeconds/.test(logical)) return "ms";
  if (/MICROS=MicroSeconds/.test(logical)) return "us";
  if (/NANOS=NanoSeconds/.test(logical)) return "ns";
  return null;
}

const INT_TYPES: Record<string, { bits: number; signed: boolean }> = {
  TINYINT: { bits: 8, signed: true },
  SMALLINT: { bits: 16, signed: true },
  INTEGER: { bits: 32, signed: true },
  BIGINT: { bits: 64, signed: true },
  UTINYINT: { bits: 8, signed: false },
  USMALLINT: { bits: 16, signed: false },
  UINTEGER: { bits: 32, signed: false },
  UBIGINT: { bits: 64, signed: false },
};

/**
 * @param duckType the engine's type for the column (from `DESCRIBE`), such as `SMALLINT` or `DECIMAL(10,2)`
 * @param row      the column's `parquet_schema` row
 */
export function mapColumn(duckType: string, row: SchemaRow): ColumnMapping {
  const type = duckType.trim().toUpperCase();
  const nullable = row.repetition_type !== "REQUIRED";

  // Nested kinds first: they must never be read.
  if (type.endsWith("]")) return { ok: false, reason: "nested_list" }; // VARCHAR[] and fixed-size arrays
  if (type.startsWith("STRUCT")) return { ok: false, reason: "nested_struct" };
  if (type.startsWith("MAP")) return { ok: false, reason: "nested_map" };
  if (type.startsWith("UNION")) return { ok: false, reason: "nested_union" };
  if (type === "BLOB") return { ok: false, reason: /UUIDType/.test(row.logical_type ?? "") ? "uuid" : "binary" };
  if (type === "UUID") return { ok: false, reason: "uuid" };
  if (type === "INTERVAL") return { ok: false, reason: "interval" };

  const int = INT_TYPES[type];
  if (int) return { ok: true, type: { kind: "int", bits: int.bits, signed: int.signed, nullable } };

  if (type === "FLOAT") return { ok: true, type: { kind: "float", bits: 32, nullable } };
  if (type === "DOUBLE") return { ok: true, type: { kind: "float", bits: 64, nullable } };

  const decimal = /^DECIMAL\((\d+),\s*(\d+)\)$/.exec(type);
  if (decimal) return { ok: true, type: { kind: "decimal", precision: Number(decimal[1]), scale: Number(decimal[2]), nullable } };

  if (type === "BOOLEAN") return { ok: true, type: { kind: "bool", nullable } };
  if (type === "VARCHAR" || type.startsWith("ENUM")) return { ok: true, type: { kind: "string", nullable } };
  if (type === "DATE") return { ok: true, type: { kind: "date", nullable } };

  if (type === "TIME") {
    const unit = unitOf(row.logical_type) ?? (row.converted_type === "TIME_MILLIS" ? "ms" : "us");
    return { ok: true, type: { kind: "time", unit, nullable } };
  }

  if (type === "TIMESTAMP" || type === "TIMESTAMP WITH TIME ZONE" || type === "TIMESTAMP_S" || type === "TIMESTAMP_MS" || type === "TIMESTAMP_NS") {
    const utc = type === "TIMESTAMP WITH TIME ZONE" || /isAdjustedToUTC=1/.test(row.logical_type ?? "");
    let unit = unitOf(row.logical_type);
    if (!unit) {
      // Legacy 96-bit timestamps carry no unit; the engine reads them with nanosecond precision.
      if (row.type === "INT96" || type === "TIMESTAMP_NS") unit = "ns";
      else if (type === "TIMESTAMP_MS" || type === "TIMESTAMP_S" || row.converted_type === "TIMESTAMP_MILLIS") unit = "ms";
      else unit = "us";
    }
    return { ok: true, type: { kind: "timestamp", unit, utc, nullable } };
  }

  return { ok: false, reason: "other" };
}
