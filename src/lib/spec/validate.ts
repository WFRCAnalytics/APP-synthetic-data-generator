// Validates a spec file loaded from disk (FR-018). Structure is checked with valibot; the rules that
// need several fields at once (counts add up, quantiles are ordered, a date pattern is supported)
// are checked by hand. Every problem names its column. Unknown fields are rejected, which is also
// what stops a hand-edited spec from smuggling in a list of ID values (FR-015, FR-019).

import * as v from "valibot";
import { isSupportedPattern, patternGranularity, patternKind } from "../datefmt/directives";
import { maskCapacity } from "../mask/mask";
import {
  boxFits,
  COORDINATE_AXES,
  MAX_COORDINATE_DECIMALS,
  type CoordinateAxis,
} from "../classify/coordinate";
import { JSON_KINDS } from "../json/types";
import { LOCALES } from "../textgen/locales";
import { typeConflict, validateParquetType, type ParquetType } from "../parquet/types";
import { describeFormat } from "../xlsx/formats";
import { isValidSheetName, parseRange } from "../xlsx/names";
import {
  MAX_LENGTH_GROUPS,
  MAX_TEXT_LENGTH,
  READABLE_SPEC_VERSIONS,
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
  coordinate: v.optional(v.picklist(COORDINATE_AXES as unknown as [string, ...string[]])),
  value_labels: v.optional(
    v.pipe(
      v.record(v.string(), v.pipe(v.string(), v.minLength(1), v.maxLength(100))),
      v.check(
        (labels) => Object.keys(labels).length <= 2000,
        "A column can have at most 2,000 value labels.",
      ),
    ),
  ),
  stored_as_text: v.optional(v.boolean()),
  parquet_type: v.optional(v.unknown()),
  json_kind: v.optional(v.picklist(JSON_KINDS as unknown as [string, ...string[]])),
  json_missing: v.optional(count),
  cell_format: v.optional(
    v.pipe(
      v.string(),
      v.minLength(1),
      v.maxLength(255),
      v.check(
        (text) => ![...text].some((ch) => ch.charCodeAt(0) < 32),
        "A cell format may not hold control characters.",
      ),
    ),
  ),
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
  scientific: v.optional(v.boolean()),
};

const MaskTokenSchema = v.union([
  v.picklist(["digit", "upper", "lower", "letter", "alnum"]),
  v.strictObject({ literal: v.pipe(v.string(), v.length(1)) }),
]);

const RepeatStructureSchema = v.record(v.string(), positiveCount);

// A shape holds 9 for a digit and A for a letter and keeps punctuation. A real digit or letter in it
// would be a value, so only the placeholders and non-alphanumeric characters are allowed.
const ShapeSchema = v.pipe(
  v.string(),
  v.regex(
    /^[9A\W_]*$/,
    "A shape may hold only 9, A and punctuation, never a real digit or letter.",
  ),
);

const PersonalFormatSchema = v.strictObject({
  shapes: v.optional(
    v.pipe(
      v.array(
        v.strictObject({
          shape: ShapeSchema,
          share: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
        }),
      ),
      v.maxLength(5),
    ),
  ),
  shape: v.optional(ShapeSchema),
  last_first: v.optional(v.boolean()),
  unit: v.optional(v.boolean()),
  zip4: v.optional(v.boolean()),
});

const PersonalSchema = v.strictObject({
  ...base,
  type: v.literal("personal"),
  kind: v.picklist([
    "full_name",
    "first_name",
    "last_name",
    "email",
    "phone",
    "address",
    "url",
    "ip",
    "ssn",
  ]),
  locale: v.optional(v.picklist(LOCALES.map((l) => l.value) as [string, ...string[]])),
  repeat_structure: RepeatStructureSchema,
  format: v.optional(PersonalFormatSchema),
  acknowledged: v.optional(v.boolean()),
});

const FreeTextSchema = v.strictObject({
  ...base,
  type: v.literal("free_text"),
  mode: numeric.mode,
  min: v.pipe(v.number(), v.finite(), v.minValue(0)),
  max: finite,
  mean: numeric.mean,
  sd: numeric.sd,
  decimals: numeric.decimals,
  quantiles: numeric.quantiles,
  rescale: numeric.rescale,
  line_breaks: v.optional(v.boolean()),
});

const ShortStringSchema = v.strictObject({
  ...base,
  type: v.literal("short_string"),
  pattern: v.pipe(v.array(MaskTokenSchema), v.minLength(1)),
  length_groups: v.record(v.string(), positiveCount),
  repeat_structure: RepeatStructureSchema,
});

const CategoricalSchema = (type: "categorical" | "boolean") =>
  v.strictObject({
    ...base,
    type: v.literal(type),
    storage: v.optional(v.picklist(["integer", "string"])),
    counts: v.record(v.string(), positiveCount),
    merge_under_k: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(2)))),
    label_codes: v.optional(v.boolean()),
  });

const NumericSchema = (type: "integer" | "float") =>
  v.strictObject({ ...base, type: v.literal(type), ...numeric });

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
  PersonalSchema,
  FreeTextSchema,
  ShortStringSchema,
  v.strictObject({ ...base, type: v.literal("empty") }),
  v.strictObject({ ...base, type: v.literal("unsupported") }),
]);

const XlsxSourceSchema = v.strictObject({
  format: v.literal("xlsx"),
  file_name: v.pipe(v.string(), v.minLength(1)),
  sheet: v.pipe(v.string(), v.minLength(1)),
  range: v.optional(v.string()),
  skip_rows: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1048575)),
  header: v.boolean(),
  date1904: v.boolean(),
});

const CsvSourceSchema = v.strictObject({
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

const ParquetSourceSchema = v.strictObject({
  format: v.literal("parquet"),
  file_name: v.pipe(v.string(), v.minLength(1)),
  row_groups: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10_000_000)),
});

const JsonSourceSchema = v.strictObject({
  format: v.literal("json"),
  file_name: v.pipe(v.string(), v.minLength(1)),
  form: v.picklist(["array", "lines"]),
  indent: v.picklist(["compact", "2", "4", "tab"]),
  line_ending: v.picklist(["lf", "crlf"]),
  trailing_newline: v.boolean(),
  bom: v.boolean(),
});

const SourceSchema = v.variant("format", [
  CsvSourceSchema,
  XlsxSourceSchema,
  ParquetSourceSchema,
  JsonSourceSchema,
]);

const SpecSchema = v.strictObject({
  spec_version: v.picklist(READABLE_SPEC_VERSIONS as [number, ...number[]]),
  source: SourceSchema,
  n_rows: count,
  seed: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(4294967295)),
  keep_original_name: v.optional(v.boolean()),
  categorical_threshold: v.optional(v.pipe(v.number(), v.integer(), v.minValue(2))),
  columns: v.pipe(v.array(ColumnSchema), v.minLength(1)),
});

function columnNameAt(input: unknown, index: number): string {
  const cols = (input as { columns?: unknown })?.columns;
  const name = Array.isArray(cols)
    ? (cols[index] as { name?: unknown } | undefined)?.name
    : undefined;
  return typeof name === "string" && name.length > 0 ? name : `column #${index + 1}`;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** A cell format must suit its column: dates and times for date columns, numbers for number columns, text only for text-like ones. */
function checkCellFormat(col: ColumnSpec, problem: (path: string, message: string) => void): void {
  const kind = describeFormat(col.cell_format as string).kind;
  const temporal = kind === "date" || kind === "time" || kind === "datetime";
  // Cells that hold text may carry any format (a text format, or the format the values would have had).
  if (col.stored_as_text) return;
  switch (col.type) {
    case "date":
    case "datetime":
    case "time":
      if (!temporal) problem("cell_format", "A date column needs a date or time format.");
      break;
    case "integer":
    case "float":
      if (temporal || kind === "text")
        problem(
          "cell_format",
          "A number column needs a number, percent, currency or scientific format.",
        );
      break;
    case "empty":
    case "unsupported":
      break;
    default:
      if (temporal && col.type !== "categorical" && col.type !== "boolean")
        problem("cell_format", "A date or time format does not suit this column.");
  }
}

/** A Parquet type must be well formed and suit its column: dates for date columns, numbers for number columns. */
function checkParquetType(col: ColumnSpec, problem: (path: string, message: string) => void): void {
  if (col.type === "unsupported") {
    problem(
      "parquet_type",
      "A column that is not supported holds nothing from the file, so it has no Parquet type.",
    );
    return;
  }
  const bad = validateParquetType(col.parquet_type);
  if (bad) {
    problem("parquet_type", bad);
    return;
  }
  const conflict = typeConflict(col.type, (col.parquet_type as ParquetType).kind);
  if (conflict) problem("parquet_type", conflict);
}

/** A JSON kind must suit its column's type (specs/007 data-model.md). */
function checkJsonKind(col: ColumnSpec, problem: (path: string, message: string) => void): void {
  const kind = col.json_kind;
  if (kind === undefined) return;
  const t = col.type;
  if (kind === "object" || kind === "array") {
    if (t !== "unsupported")
      problem(
        "json_kind",
        "A key that holds an object or a list is not supported, so it is not given a type.",
      );
    return;
  }
  if (t === "unsupported") {
    problem("json_kind", "A key that is not supported must be an object or a list.");
    return;
  }
  if (
    kind === "number" &&
    (t === "date" || t === "datetime" || t === "time" || t === "free_text" || t === "personal")
  )
    problem("json_kind", "A key of numbers cannot be a date, personal or free-text column.");
  if (kind === "boolean" && t !== "boolean" && t !== "categorical")
    problem("json_kind", "A key of true and false must be a yes or no, or a category.");
  if (kind === "null" && t !== "empty")
    problem("json_kind", "A key that was always null must be an empty column.");
  if (col.json_missing !== undefined) {
    const token = col.na?.tokens[0] ?? "";
    const missingCells = col.na
      ? col.na.by_token
        ? (col.na.by_token[token] ?? 0)
        : col.na.count
      : 0;
    if (col.json_missing > missingCells)
      problem("json_missing", "The records without the key cannot outnumber the missing values.");
  }
}

/** Checks a repeat structure and returns the distinct count, or null after reporting a problem. */
function checkRepeat(
  structure: Record<string, number>,
  remaining: number,
  problem: (path: string, message: string) => void,
): number | null {
  const keys = Object.keys(structure);
  if (keys.some((k) => !/^[1-9]\d*$/.test(k))) {
    problem("repeat_structure", "Group sizes must be positive whole numbers.");
    return null;
  }
  const rowsCovered = keys.reduce((acc, k) => acc + Number(k) * structure[k], 0);
  if (rowsCovered !== remaining) {
    problem(
      "repeat_structure",
      `The repeat structure covers ${rowsCovered} rows, but ${remaining} rows are left after NA.`,
    );
  }
  return keys.reduce((acc, k) => acc + structure[k], 0);
}

// Cross-field rules for one column. `rows` is the table's row count.
function checkColumn(col: ColumnSpec, rows: number, out: SpecProblem[]): void {
  const problem = (path: string, message: string) => out.push({ column: col.name, path, message });
  const naCount = col.na?.count ?? 0;
  const sentinelCount = sum(Object.values(col.sentinels ?? {}));

  if (naCount + sentinelCount > rows) {
    problem(
      "na",
      `NA and sentinel counts (${naCount + sentinelCount}) exceed the row count (${rows}).`,
    );
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

  if (col.coordinate !== undefined && col.type !== "integer" && col.type !== "float")
    problem("coordinate", "Only a number column can be a coordinate.");

  if (col.value_labels !== undefined) {
    // A label belongs to a value the column already holds (a category or a sentinel code), so the spec carries no other text.
    const known = new Set([
      ...(col.type === "categorical" || col.type === "boolean" ? Object.keys(col.counts) : []),
      ...Object.keys(col.sentinels ?? {}),
    ]);
    if (Object.keys(col.value_labels).some((k) => !known.has(k)))
      problem("value_labels", "A value label names a value the column does not hold.");
  }

  if (col.cell_format !== undefined) checkCellFormat(col, problem);
  if (col.parquet_type !== undefined) checkParquetType(col, problem);
  checkJsonKind(col, problem);

  switch (col.type) {
    case "categorical":
    case "boolean": {
      const total = sum(Object.values(col.counts));
      if (total !== remaining) {
        problem(
          "counts",
          `Category counts add up to ${total}, but ${remaining} rows are left after NA and sentinels.`,
        );
      }
      if (col.type === "boolean" && Object.keys(col.counts).length > 2) {
        problem("counts", "A boolean column can have at most two values.");
      }
      break;
    }
    case "personal": {
      checkRepeat(col.repeat_structure, remaining, problem);
      if (
        col.locale !== undefined &&
        (col.kind === "ssn" || col.kind === "url" || col.kind === "ip")
      )
        problem(
          "locale",
          "A region applies to names, emails, phone numbers and street addresses only.",
        );
      if (col.acknowledged !== undefined && col.kind !== "ssn")
        problem("acknowledged", "Only SSN-style columns take an acknowledgement.");
      if (
        col.kind === "ssn" &&
        col.acknowledged !== true &&
        (col.exclude === undefined || col.exclude === "include")
      ) {
        problem(
          "acknowledged",
          "SSN-style numbers are generated only after the user acknowledges it (acknowledged: true), or the column must be left out.",
        );
      }
      const f = col.format;
      if (f) {
        const allowed: Record<string, string[]> = {
          phone: ["shapes"],
          ssn: ["shape"],
          full_name: ["last_first"],
          address: ["unit", "zip4"],
        };
        const extra = Object.keys(f).filter((k) => !(allowed[col.kind] ?? []).includes(k));
        if (extra.length > 0)
          problem(
            "format",
            `The format field ${extra.join(", ")} does not apply to the kind ${col.kind}.`,
          );
      }
      break;
    }
    case "short_string": {
      const distinct = checkRepeat(col.repeat_structure, remaining, problem);
      const lengths = Object.keys(col.length_groups);
      if (lengths.length > MAX_LENGTH_GROUPS)
        problem("length_groups", `At most ${MAX_LENGTH_GROUPS} different lengths are kept.`);
      if (lengths.some((k) => !/^[1-9]\d*$/.test(k))) {
        problem("length_groups", "Lengths must be positive whole numbers.");
      } else {
        const longest = Math.max(0, ...lengths.map(Number));
        if (longest !== col.pattern.length)
          problem(
            "pattern",
            `The pattern has ${col.pattern.length} positions but the longest length is ${longest}.`,
          );
        const groups = sum(Object.values(col.length_groups));
        if (distinct !== null && groups !== distinct)
          problem(
            "length_groups",
            `The length groups add up to ${groups}, but the repeat structure has ${distinct} distinct values.`,
          );
        // A column that is left out needs no room in its pattern; one that is generated does.
        const generated = col.exclude === undefined || col.exclude === "include";
        for (const k of generated ? lengths : []) {
          const allowed = maskCapacity(col.pattern.slice(0, Number(k)));
          if (allowed < BigInt(col.length_groups[k])) {
            problem(
              "pattern",
              `For length ${k} the pattern allows ${allowed} distinct values but the column needs ${col.length_groups[k]}.`,
            );
          }
        }
      }
      break;
    }
    case "free_text":
    case "integer":
    case "float":
    case "date":
    case "datetime":
    case "time": {
      if (col.min > col.max) problem("min", "min is greater than max.");
      if (col.coordinate !== undefined) {
        if (col.type !== "integer" && col.type !== "float")
          problem("coordinate", "Only a number column can be a coordinate.");
        else {
          const axis = col.coordinate as CoordinateAxis;
          if (!boxFits(axis, col.min, col.max))
            problem(
              "coordinate",
              `The bounding box does not fit a ${axis === "lat" ? "latitude (-90 to 90)" : axis === "lon" ? "longitude (-180 to 180)" : "coordinate"}.`,
            );
          if (col.mode !== "uniform")
            problem(
              "coordinate",
              "A coordinate is spread evenly inside its bounding box, so its mode is uniform.",
            );
          if (col.mean !== undefined || col.sd !== undefined || col.quantiles !== undefined)
            problem(
              "coordinate",
              "A coordinate keeps only its bounding box and decimal places, not a mean, spread or percentiles.",
            );
          if ((col.decimals ?? 0) > MAX_COORDINATE_DECIMALS)
            problem(
              "decimals",
              `A coordinate keeps at most ${MAX_COORDINATE_DECIMALS} decimal places.`,
            );
        }
      }
      if (col.type === "free_text" && col.max > MAX_TEXT_LENGTH)
        problem(
          "max",
          `Text lengths are kept up to ${MAX_TEXT_LENGTH.toLocaleString("en-US")} characters.`,
        );
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
        if (col.quantiles.length !== 101)
          problem("quantiles", `Expected 101 quantiles, found ${col.quantiles.length}.`);
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
            problem(
              "format",
              `The pattern describes a ${patternKind(col.format)}, but the column type is ${col.type}.`,
            );
          }
          if (patternGranularity(col.format) !== col.granularity) {
            problem(
              "granularity",
              `The pattern's finest unit is ${patternGranularity(col.format)}, not ${col.granularity}.`,
            );
          }
        }
      }
      break;
    }
    case "survey_id": {
      if (col.min !== undefined && col.max !== undefined && col.min > col.max)
        problem("min", "min is greater than max.");
      checkRepeat(col.repeat_structure, remaining, problem);
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
  if (
    typeof version === "number" &&
    Number.isInteger(version) &&
    !READABLE_SPEC_VERSIONS.includes(version)
  ) {
    const reads = `this app reads versions ${READABLE_SPEC_VERSIONS[0]} to ${SPEC_VERSION}`;
    const message =
      version > SPEC_VERSION
        ? `This spec was made by a newer version of the app (spec version ${version}); ${reads}.`
        : `This spec uses an older, unsupported format (spec version ${version}); ${reads}.`;
    return { ok: false, problems: [{ column: null, path: "spec_version", message }] };
  }

  const parsed = v.safeParse(SpecSchema, input);
  if (!parsed.success) {
    const problems: SpecProblem[] = parsed.issues.map((issue) => {
      const keys = (issue.path ?? []).map((p) => p.key as string | number);
      const column =
        keys[0] === "columns" && typeof keys[1] === "number" ? columnNameAt(input, keys[1]) : null;
      const rest = column === null ? keys : keys.slice(2);
      return { column, path: rest.join(".") || "(column)", message: issue.message };
    });
    return { ok: false, problems };
  }

  const spec = parsed.output as unknown as SpecFile;
  const problems: SpecProblem[] = [];

  if (spec.source.format === "xlsx") {
    const src = spec.source;
    if (!isValidSheetName(src.sheet))
      problems.push({
        column: null,
        path: "source.sheet",
        message:
          "The sheet name is not valid: it must be 1 to 31 characters without []:*?/\\ and without an apostrophe at either end.",
      });
    if (src.range !== undefined) {
      const range = parseRange(src.range);
      if (!range)
        problems.push({
          column: null,
          path: "source.range",
          message: "The cell range is not valid. Use a range such as A3:I203.",
        });
      else if (range.firstRow !== src.skip_rows)
        problems.push({
          column: null,
          path: "source.skip_rows",
          message: `The range starts at row ${range.firstRow + 1}, so the rows skipped must be ${range.firstRow}, not ${src.skip_rows}.`,
        });
    }
  }

  if (spec.source.format === "parquet") {
    for (const col of spec.columns) {
      const written =
        (col.exclude ?? "include") !== "drop" && col.type !== "unsupported" && col.type !== "empty";
      if (col.parquet_type === undefined && written)
        problems.push({
          column: col.name,
          path: "parquet_type",
          message: "A column of a Parquet spec needs its Parquet type (parquet_type).",
        });
    }
  } else {
    for (const col of spec.columns) {
      if (col.parquet_type !== undefined)
        problems.push({
          column: col.name,
          path: "parquet_type",
          message: "Only a spec for a Parquet file may give a Parquet type.",
        });
    }
  }

  if (spec.source.format === "json") {
    for (const col of spec.columns) {
      if (col.json_kind === undefined)
        problems.push({
          column: col.name,
          path: "json_kind",
          message: "A column of a JSON spec needs its JSON kind (json_kind).",
        });
      if (col.cell_format !== undefined || col.stored_as_text !== undefined)
        problems.push({
          column: col.name,
          path: "cell_format",
          message: "A JSON spec has no cell formats.",
        });
    }
  } else {
    for (const col of spec.columns) {
      if (col.json_kind !== undefined || col.json_missing !== undefined)
        problems.push({
          column: col.name,
          path: "json_kind",
          message: "Only a spec for a JSON file may give a JSON kind.",
        });
    }
  }

  const seen = new Set<string>();
  for (const col of spec.columns) {
    if (seen.has(col.name))
      problems.push({ column: col.name, path: "name", message: "Duplicate column name." });
    seen.add(col.name);
    checkColumn(col, spec.n_rows, problems);
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, spec };
}
