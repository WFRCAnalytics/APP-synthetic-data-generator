// Turns a design into an ordinary spec (specs/006 plan). Each kind of column becomes the summary the
// generator already understands, built from what the person said: no data is read, none is invented
// to look real. The result is validated with the same validator as a spec file the person loads.

import { patternGranularity, patternKind } from "../datefmt/directives";
import type { JsonKind } from "../json/types";
import type { ParquetType } from "../parquet/types";
import type { ColumnSpec, MaskToken, SourceSpec, SpecFile } from "../spec/types";
import { SPEC_VERSION } from "../spec/types";
import { validateSpec } from "../spec/validate";
import { apportion, bellQuantiles, evenQuantiles, meanOf, sdOf } from "./quantiles";
import { missingCount, parseDay, presentRows, validateDesign } from "./validate";
import { extensionOf, type Design, type DesignColumn, type DesignOutput, type DesignProblem } from "./types";

const na = (rows: number, pct: number) => {
  const count = missingCount(rows, pct);
  return count > 0 ? { na: { tokens: [""], count } } : {};
};

const round = (x: number, decimals: number) => Number(x.toFixed(decimals));

export function columnSpecOf(c: DesignColumn, rows: number): ColumnSpec {
  const name = c.name.trim();
  const base = { name, exclude: "include" as const, ...na(rows, c.missingPct) };
  const present = presentRows(rows, c.missingPct);

  switch (c.kind) {
    case "integer":
    case "decimal": {
      const decimals = c.kind === "integer" ? 0 : c.decimals;
      if (c.shape === "bell") {
        const q = bellQuantiles(c.min, c.max, c.typical, c.spread).map((v) => round(v, Math.max(decimals, 6)));
        return { ...base, type: c.kind === "integer" ? "integer" : "float", mode: "match_shape", min: c.min, max: c.max, mean: round(meanOf(q), 6), sd: round(sdOf(q), 6), decimals, quantiles: q };
      }
      return { ...base, type: c.kind === "integer" ? "integer" : "float", mode: "uniform", min: c.min, max: c.max, mean: (c.min + c.max) / 2, sd: round((c.max - c.min) / Math.sqrt(12), 6), decimals, quantiles: evenQuantiles(c.min, c.max) };
    }

    case "category": {
      const counts = apportion(c.labels.map((l) => l.weight), present);
      const entries: Record<string, number> = {};
      c.labels.forEach((l, i) => {
        if (counts[i] > 0) entries[l.label] = counts[i];
      });
      return { ...base, type: "categorical", storage: "string", counts: entries };
    }

    case "yesno": {
      const [yes, no] = apportion([c.yesPct, 100 - c.yesPct], present);
      const entries: Record<string, number> = {};
      if (yes > 0) entries[c.yesLabel] = yes;
      if (no > 0) entries[c.noLabel] = no;
      return { ...base, type: "boolean", storage: "string", counts: entries };
    }

    case "date":
    case "datetime": {
      const kind = patternKind(c.format);
      const start = parseDay(c.start) as number;
      const end = parseDay(c.end) as number;
      // Days since the epoch for a date; seconds for a moment, from the start of the first day to the end of the last.
      const [min, max] = kind === "date" ? [start / 86400000, end / 86400000] : [start / 1000, end / 1000 + 86399];
      return { ...base, type: c.kind, mode: "uniform", format: c.format, granularity: patternGranularity(c.format), min, max, mean: (min + max) / 2, sd: round((max - min) / Math.sqrt(12), 3), decimals: 0, quantiles: evenQuantiles(min, max) };
    }

    case "id": {
      const mask: MaskToken[] = [...c.prefix].map((ch) => ({ literal: ch }));
      for (let i = 0; i < c.digits; i++) mask.push("digit");
      return { ...base, type: "survey_id", mask, repeat_structure: { "1": present } };
    }

    case "personal":
      return { ...base, type: "personal", kind: c.personal, repeat_structure: { "1": present } };

    case "text":
      return {
        ...base,
        type: "free_text",
        mode: "uniform",
        min: c.minLength,
        max: c.maxLength,
        mean: (c.minLength + c.maxLength) / 2,
        sd: round((c.maxLength - c.minLength) / Math.sqrt(12), 3),
        decimals: 0,
        quantiles: evenQuantiles(c.minLength, c.maxLength).map((v) => Math.round(v)),
        line_breaks: false,
      };
  }
}

/** A sheet name from a table name: the characters a sheet cannot hold are replaced, and it is cut to 31 characters. */
export function sheetNameOf(tableName: string): string {
  const cleaned = tableName.trim().replace(/[[\]:*?/\\]/g, "_").replace(/^'+|'+$/g, "").slice(0, 31);
  return cleaned === "" ? "Sheet1" : cleaned;
}

const YES_NO = [
  ["yes", "no"],
  ["y", "n"],
  ["true", "false"],
  ["t", "f"],
];

/** Whether a yes-or-no column's two labels are a plain pair a JSON file can write as true and false. */
const isPlainYesNo = (yes: string, no: string): boolean => YES_NO.some(([a, b]) => yes.trim().toLowerCase() === a && no.trim().toLowerCase() === b);

/** The number format of a workbook cell for a column (specs/009 assumptions). */
function cellFormatOf(c: DesignColumn): string | undefined {
  switch (c.kind) {
    case "integer":
      return "0";
    case "decimal":
      return c.decimals > 0 ? `0.${"0".repeat(c.decimals)}` : "0";
    case "date":
      return "yyyy-mm-dd";
    case "datetime":
      return "yyyy-mm-dd hh:mm:ss";
    default:
      return undefined;
  }
}

/** The smallest signed integer width that holds a range. */
function intBits(min: number, max: number): 8 | 16 | 32 | 64 {
  if (min >= -128 && max <= 127) return 8;
  if (min >= -32768 && max <= 32767) return 16;
  if (min >= -2147483648 && max <= 2147483647) return 32;
  return 64;
}

function parquetTypeOf(c: DesignColumn): ParquetType {
  switch (c.kind) {
    case "integer":
      return { kind: "int", bits: intBits(c.min, c.max), signed: true, nullable: true };
    case "decimal":
      return { kind: "float", bits: 64, nullable: true };
    case "date":
      return { kind: "date", nullable: true };
    case "datetime":
      return { kind: "timestamp", unit: "us", utc: false, nullable: true };
    default:
      return { kind: "string", nullable: true };
  }
}

function jsonKindOf(c: DesignColumn): JsonKind {
  switch (c.kind) {
    case "integer":
    case "decimal":
      return "number";
    case "yesno":
      return isPlainYesNo(c.yesLabel, c.noLabel) ? "boolean" : "string";
    default:
      return "string";
  }
}

/** What a format needs to know about a column beyond what the generator needs. */
function withFormatFields(spec: ColumnSpec, c: DesignColumn, output: DesignOutput): ColumnSpec {
  switch (output) {
    case "xlsx": {
      const format = cellFormatOf(c);
      return format ? { ...spec, cell_format: format } : spec;
    }
    case "parquet":
      return { ...spec, parquet_type: parquetTypeOf(c) };
    case "json":
    case "ndjson":
      return { ...spec, json_kind: jsonKindOf(c), json_missing: 0 };
    default:
      return spec;
  }
}

function sourceOf(design: Design): SourceSpec {
  const file_name = `${design.tableName.trim()}.${extensionOf(design.output)}`;
  switch (design.output) {
    case "xlsx":
      return { format: "xlsx", file_name, sheet: sheetNameOf(design.tableName), skip_rows: 0, header: true, date1904: false };
    case "parquet":
      return { format: "parquet", file_name, row_groups: Math.max(1, Math.ceil(design.rows / 65536)) };
    case "json":
      return { format: "json", file_name, form: "array", indent: "2", line_ending: "lf", trailing_newline: true, bom: false };
    case "ndjson":
      return { format: "json", file_name, form: "lines", indent: "compact", line_ending: "lf", trailing_newline: true, bom: false };
    default:
      return { format: "csv", file_name, encoding: "utf-8", delimiter: ",", quote: '"', quote_style: "minimal", line_ending: "lf", trailing_newline: true, header: true };
  }
}

export type DesignResult = { ok: true; spec: SpecFile } | { ok: false; problems: DesignProblem[] };

/** The spec of a design, or the problems that stop it from being one. */
export function specFromDesign(design: Design): DesignResult {
  const problems = validateDesign(design);
  if (design.columns.length === 0) problems.push({ columnId: null, field: "columns", message: "Add at least one column." });
  if (problems.length > 0) return { ok: false, problems };

  const spec: SpecFile = {
    spec_version: SPEC_VERSION,
    source: sourceOf(design),
    n_rows: design.rows,
    seed: design.seed,
    columns: design.columns.map((c) => withFormatFields(columnSpecOf(c, design.rows), c, design.output)),
  };

  // The same validator as a loaded spec: a design that passes it is a spec the rest of the app accepts.
  const checked = validateSpec(JSON.parse(JSON.stringify(spec)));
  if (!checked.ok) return { ok: false, problems: checked.problems.map((p) => ({ columnId: design.columns.find((c) => c.name.trim() === p.column)?.id ?? null, field: "spec", message: p.message })) };
  return { ok: true, spec: checked.spec };
}
