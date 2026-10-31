// Validates a spec file loaded from disk (FR-018). Structure is checked with valibot; the rules that
// need several fields at once (counts add up, quantiles are ordered, a date pattern is supported)
// are checked by hand. Every problem names its column. Unknown fields are rejected, which is also
// what stops a hand-edited spec from smuggling in a list of ID values (FR-015, FR-019).

import * as v from "valibot";
import { isSupportedPattern, patternGranularity, patternKind } from "../datefmt/directives";
import {
  SPEC_VERSION,
  type ColumnSpec,
  type SpecFile,
  type SpecProblem,
  type SpecResult,
} from "./types";

const finite = v.pipe(v.number(), v.finite());
const count = v.pipe(v.number(), v.integer(), v.minValue(0));
const positiveCount = v.pipe(v.number(), v.integer(), v.minValue(1));

const NaSchema = v.strictObject({
  tokens: v.pipe(v.array(v.string()), v.minLength(1)),
  count,
  by_token: v.optional(v.record(v.string(), count)),
});

const SentinelsSchema = v.record(v.string(), positiveCount);

const base = {
  name: v.pipe(v.string(), v.minLength(1)),
  output_name: v.optional(v.pipe(v.string(), v.minLength(1))),
  exclude: v.optional(v.picklist(["drop", "keep_as_na", "include"])),
  quoted: v.optional(v.boolean()),
  na: v.optional(NaSchema),
  sentinels: v.optional(SentinelsSchema),
};

const numeric = {
  mode: v.picklist(["uniform", "match_mean_sd", "match_shape"]),
  min: finite,
  max: finite,
  mean: v.optional(finite),
  sd: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0))),
  decimals: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(15))),
  quantiles: v.optional(v.array(finite)),
  rescale: v.optional(v.boolean()),
  thousands: v.optional(v.boolean()),
};

const MaskTokenSchema = v.union([
  v.picklist(["digit", "letter", "alnum"]),
  v.strictObject({ literal: v.pipe(v.string(), v.length(1)) }),
]);

const CategoricalSchema = (type: "categorical" | "boolean") =>
  v.strictObject({
    ...base,
    type: v.literal(type),
    storage: v.optional(v.picklist(["integer", "string"])),
    counts: v.record(v.string(), positiveCount),
    merge_under_k: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(2)))),
    label_codes: v.optional(v.boolean()),
  });

const NumericSchema = (type: "integer" | "float") => v.strictObject({ ...base, type: v.literal(type), ...numeric });

const DateSchema = (type: "date" | "datetime" | "time") =>
  v.strictObject({
    ...base,
    type: v.literal(type),
    ...numeric,
    format: v.pipe(v.string(), v.minLength(1)),
    granularity: v.picklist(["day", "minute", "second"]),
  });

const ColumnSchema = v.variant("type", [
  CategoricalSchema("categorical"),
  CategoricalSchema("boolean"),
  NumericSchema("integer"),
  NumericSchema("float"),
  DateSchema("date"),
  DateSchema("datetime"),
  DateSchema("time"),
  v.strictObject({
    ...base,
    type: v.literal("survey_id"),
    mask: v.pipe(v.array(MaskTokenSchema), v.minLength(1)),
    min: v.optional(v.pipe(v.number(), v.integer())),
    max: v.optional(v.pipe(v.number(), v.integer())),
    pad_width: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
    repeat_structure: v.record(v.string(), positiveCount),
  }),
  v.strictObject({ ...base, type: v.literal("empty") }),
  v.strictObject({ ...base, type: v.literal("unsupported") }),
]);

const SourceSchema = v.strictObject({
  format: v.literal("csv"),
  file_name: v.pipe(v.string(), v.minLength(1)),
  encoding: v.picklist(["utf-8", "utf-16le", "utf-16be", "windows-1252"]),
  bom: v.optional(v.boolean()),
  delimiter: v.pipe(v.string(), v.length(1)),
  quote: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(1)))),
  quote_style: v.optional(v.picklist(["minimal", "all", "per_column"])),
  line_ending: v.optional(v.picklist(["lf", "crlf", "cr"])),
  trailing_newline: v.optional(v.boolean()),
  header: v.boolean(),
  header_quoted: v.optional(v.boolean()),
});

const SpecSchema = v.strictObject({
  spec_version: v.literal(SPEC_VERSION),
  source: SourceSchema,
  n_rows: count,
  seed: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(4294967295)),
  keep_original_name: v.optional(v.boolean()),
  categorical_threshold: v.optional(v.pipe(v.number(), v.integer(), v.minValue(2))),
  columns: v.pipe(v.array(ColumnSchema), v.minLength(1)),
});

function columnNameAt(input: unknown, index: number): string {
  const cols = (input as { columns?: unknown })?.columns;
  const name = Array.isArray(cols) ? (cols[index] as { name?: unknown } | undefined)?.name : undefined;
  return typeof name === "string" && name.length > 0 ? name : `column #${index + 1}`;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

// Cross-field rules for one column. `rows` is the table's row count.
function checkColumn(col: ColumnSpec, rows: number, out: SpecProblem[]): void {
  const problem = (path: string, message: string) => out.push({ column: col.name, path, message });
  const naCount = col.na?.count ?? 0;
  const sentinelCount = sum(Object.values(col.sentinels ?? {}));

  if (naCount + sentinelCount > rows) {
    problem("na", `NA and sentinel counts (${naCount + sentinelCount}) exceed the row count (${rows}).`);
  }
  const remaining = rows - naCount - sentinelCount;

  if (col.na?.by_token) {
    const byToken = col.na.by_token;
    if (sum(Object.values(byToken)) !== col.na.count) {
      problem("na", "Per-token NA counts do not add up to the NA count.");
    }
    if (Object.keys(byToken).some((t) => !col.na!.tokens.includes(t))) {
      problem("na", "A per-token NA count names a token that is not in the token list.");
    }
  }

  switch (col.type) {
    case "categorical":
    case "boolean": {
      const total = sum(Object.values(col.counts));
      if (total !== remaining) {
        problem("counts", `Category counts add up to ${total}, but ${remaining} rows are left after NA and sentinels.`);
      }
      if (col.type === "boolean" && Object.keys(col.counts).length > 2) {
        problem("counts", "A boolean column can have at most two values.");
      }
      break;
    }
    case "integer":
    case "float":
    case "date":
    case "datetime":
    case "time": {
      if (col.min > col.max) problem("min", "min is greater than max.");
      if (col.mode === "match_mean_sd" && (col.mean === undefined || col.sd === undefined)) {
        problem("mode", "match_mean_sd needs both mean and sd.");
      }
      if (col.mode === "match_shape" && col.quantiles === undefined) {
        problem("mode", "match_shape needs quantiles.");
      }
      if (col.mean !== undefined && (col.mean < col.min || col.mean > col.max)) {
        problem("mean", "mean lies outside [min, max].");
      }
      if (col.quantiles) {
        if (col.quantiles.length !== 101) problem("quantiles", `Expected 101 quantiles, found ${col.quantiles.length}.`);
        else {
          const ordered = col.quantiles.every((q, i) => i === 0 || q >= col.quantiles![i - 1]);
          if (!ordered) problem("quantiles", "Quantiles must not decrease.");
          if (col.quantiles[0] < col.min || col.quantiles[100] > col.max) {
            problem("quantiles", "Quantiles lie outside [min, max].");
          }
        }
      }
      if (col.type === "date" || col.type === "datetime" || col.type === "time") {
        if (!isSupportedPattern(col.format)) {
          problem("format", "The date pattern uses a directive this version does not support.");
        } else {
          if (patternKind(col.format) !== col.type) {
            problem("format", `The pattern describes a ${patternKind(col.format)}, but the column type is ${col.type}.`);
          }
          if (patternGranularity(col.format) !== col.granularity) {
            problem("granularity", `The pattern's finest unit is ${patternGranularity(col.format)}, not ${col.granularity}.`);
          }
        }
      }
      break;
    }
    case "survey_id": {
      if (col.min !== undefined && col.max !== undefined && col.min > col.max) problem("min", "min is greater than max.");
      const keys = Object.keys(col.repeat_structure);
      if (keys.some((k) => !/^[1-9]\d*$/.test(k))) {
        problem("repeat_structure", "Group sizes must be positive whole numbers.");
      } else {
        const rowsCovered = keys.reduce((acc, k) => acc + Number(k) * col.repeat_structure[k], 0);
        if (rowsCovered !== remaining) {
          problem("repeat_structure", `The repeat structure covers ${rowsCovered} rows, but ${remaining} rows are left after NA.`);
        }
      }
      break;
    }
    case "empty":
    case "unsupported":
      break;
  }
}

/** Validates unknown input as a spec. */
export function validateSpec(input: unknown): SpecResult {
  // A version mismatch is the most useful thing to report first.
  const version = (input as { spec_version?: unknown } | null)?.spec_version;
  if (typeof version === "number" && Number.isInteger(version) && version !== SPEC_VERSION) {
    const message =
      version > SPEC_VERSION
        ? `This spec was made by a newer version of the app (spec version ${version}); this app reads version ${SPEC_VERSION}.`
        : `This spec uses an older, unsupported format (spec version ${version}); this app reads version ${SPEC_VERSION}.`;
    return { ok: false, problems: [{ column: null, path: "spec_version", message }] };
  }

  const parsed = v.safeParse(SpecSchema, input);
  if (!parsed.success) {
    const problems: SpecProblem[] = parsed.issues.map((issue) => {
      const keys = (issue.path ?? []).map((p) => p.key as string | number);
      const column = keys[0] === "columns" && typeof keys[1] === "number" ? columnNameAt(input, keys[1]) : null;
      const rest = column === null ? keys : keys.slice(2);
      return { column, path: rest.join(".") || "(column)", message: issue.message };
    });
    return { ok: false, problems };
  }

  const spec = parsed.output as unknown as SpecFile;
  const problems: SpecProblem[] = [];

  const seen = new Set<string>();
  for (const col of spec.columns) {
    if (seen.has(col.name)) problems.push({ column: col.name, path: "name", message: "Duplicate column name." });
    seen.add(col.name);
    checkColumn(col, spec.n_rows, problems);
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, spec };
}
