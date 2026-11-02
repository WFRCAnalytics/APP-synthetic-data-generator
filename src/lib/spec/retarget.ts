// Writing a table as another file type than the one it was read from (specs/020). The spec of a table keeps what the
// generator needs; what a file type needs beyond that (a workbook's cell formats, a Parquet column's logical type, a JSON
// key's kind) is worked out here from the column's type, with the same rules a designed table uses. Nothing is read from
// data: only the spec's own summaries are looked at.

import { intBits, sourceForOutput } from "../design/build";
import type { DesignOutput } from "../design/types";
import type { JsonKind } from "../json/types";
import type { ParquetType } from "../parquet/types";
import type { ColumnSpec, SpecFile } from "./types";

export type OutputKind = DesignOutput;

/** Which file type a spec's source writes. */
export function outputKindOf(spec: SpecFile): OutputKind {
  const s = spec.source;
  if (s.format === "json") return s.form === "lines" ? "ndjson" : "json";
  return s.format;
}

const YES_NO = [
  ["yes", "no"],
  ["y", "n"],
  ["true", "false"],
  ["t", "f"],
];

/** Whether a yes-or-no column's two labels are a plain pair that a JSON key can hold as true and false. */
const plainYesNo = (counts: Record<string, number>): boolean => {
  const labels = Object.keys(counts).map((l) => l.trim().toLowerCase());
  return YES_NO.some(([a, b]) => labels.every((l) => l === a || l === b));
};

function cellFormatOf(c: ColumnSpec): string | undefined {
  switch (c.type) {
    case "integer":
      return "0";
    case "float": {
      const decimals = c.decimals ?? 0;
      return decimals > 0 ? `0.${"0".repeat(decimals)}` : "0";
    }
    case "date":
      return "yyyy-mm-dd";
    case "datetime":
      return "yyyy-mm-dd hh:mm:ss";
    default:
      return undefined;
  }
}

function parquetTypeOf(c: ColumnSpec): ParquetType {
  switch (c.type) {
    case "integer":
      return { kind: "int", bits: intBits(c.min, c.max), signed: true, nullable: true };
    case "float":
      return { kind: "float", bits: 64, nullable: true };
    case "date":
      return { kind: "date", nullable: true };
    case "datetime":
      return { kind: "timestamp", unit: "us", utc: false, nullable: true };
    default:
      return { kind: "string", nullable: true };
  }
}

function jsonKindOf(c: ColumnSpec): JsonKind {
  switch (c.type) {
    case "integer":
    case "float":
      return "number";
    case "boolean":
      return plainYesNo(c.counts) ? "boolean" : "string";
    case "empty":
      return "null";
    default:
      return "string";
  }
}

function withFormatFields(c: ColumnSpec, kind: OutputKind): ColumnSpec {
  const { cell_format: _a, parquet_type: _b, json_kind: _c, json_missing: _d, ...plain } = c;
  void [_a, _b, _c, _d];
  switch (kind) {
    case "xlsx": {
      const format = cellFormatOf(c);
      return format ? { ...plain, cell_format: format } : plain;
    }
    case "parquet":
      return { ...plain, parquet_type: parquetTypeOf(c) };
    case "json":
    case "ndjson":
      return { ...plain, json_kind: jsonKindOf(c), json_missing: 0 };
    default:
      return plain;
  }
}

/** The file name without its extension. */
const stemOf = (fileName: string): string => fileName.replace(/\.[^.]*$/, "") || "table";

/** The same table, written as this file type. The column summaries, rules and seed are untouched. */
export function retarget(spec: SpecFile, kind: OutputKind): SpecFile {
  if (outputKindOf(spec) === kind) return spec;
  return {
    ...spec,
    source: sourceForOutput(kind, stemOf(spec.source.file_name), spec.n_rows),
    columns: spec.columns.map((c) => withFormatFields(c, kind)),
  };
}
