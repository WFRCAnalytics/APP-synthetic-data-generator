# Data Model: CSV Synthetic Data Slice

**Feature**: 001-csv-synthetic-slice | **Date**: 2026-10-30

Only the **Spec** is ever saved. Everything else lives in memory for the session. Real rows exist
only inside the in-memory database and are never copied into these objects.

## Entities

### SourceTable *(memory, worker only)*

| Field | Description |
|---|---|
| fileName | Original file name |
| fileSize | Bytes |
| rowCount | Number of data rows |
| columnNames | Ordered list of names (after header handling) |

### FileSettings *(saved in the spec)*

| Field | Values |
|---|---|
| encoding | `utf-8`, `utf-16le`, `utf-16be`, `windows-1252` |
| bom | boolean |
| delimiter | single character |
| quote | single character, or none |
| quoteStyle | `minimal` (quote only when needed), `all` (quote every field), `per_column` (quote exactly the columns whose `quoted` flag is true, as in files where text is quoted and numbers are not) |
| lineEnding | `lf`, `crlf`, `cr` |
| header | boolean |
| trailingNewline | boolean |

### ColumnProfile *(memory; its settings are saved in the spec)*

| Field | Description |
|---|---|
| name | Column name from the file |
| outputName | Name written to the export (differs only if renamed) |
| quoted | Whether the source wrote this column's non-empty fields in quotes, inferred by sampling the raw bytes of the first 10,000 rows (the all-text read loses this). Used when `quoteStyle` is `per_column` |
| detectedType | Type chosen by the profiler |
| type | Type in effect (user override or detected) |
| status | `ok`, `needs_attention`, `unsupported` |
| attentionReasons | List of reason codes (see below) |
| naTokens | Tokens that mean missing for this column |
| naCount | Number of NA rows |
| sentinels | Map from sentinel code to exact count |
| exclude | `drop` (default), `keep_as_na`, or `include` |
| summary | Type-specific block below |

**Types**: `empty`, `boolean`, `categorical`, `integer`, `float`, `date`, `datetime`, `time`,
`survey_id`, `unsupported`.

**Reason codes**: `possible_identifier`, `possible_sentinel`, `near_categorical_threshold`,
`date_format_unrecognized`, `date_format_mixed`, `date_format_ambiguous`, `id_mask_too_narrow`, `id_mixed_masks`,
`beta_fit_failed`,
`unsupported_type`.

### Summary blocks

| Type | Fields |
|---|---|
| categorical, boolean | `storage` (`integer` or `string`), `counts` (label to count; real labels allowed), `mergeUnderK`, `labelCodes` |
| integer, float | `min`, `max`, `mean`, `sd`, `decimals`, `mode` (`uniform`, `match_mean_sd`, `match_shape`), `quantiles` (101 values), `histogram` (20 bins, used only for the card chart), `rescale` (boolean) |
| date, datetime, time | `format` (pattern), `granularity` (`day`, `minute`, `second`), plus the numeric block above in the converted unit |
| survey_id | `mask` (token list), `min`, `max` (numeric IDs only), `padWidth`, `repeatStructure` (group size to number of groups) |
| empty | none |
| unsupported | none (the spec stores only the name and the user's choice) |

### IdMask

An ordered list of tokens: `digit`, `letter`, `alnum`, or `literal(char)`. Derived values:
`capacity` (distinct values the mask allows, restricted to `[min, max]` for numeric IDs) and
`needed` (distinct groups the repeat structure requires). Valid only when `capacity >= needed`
(FR-016a).

### Spec *(saved file)*

| Field | Description |
|---|---|
| specVersion | Integer, starts at 1 |
| source | `fileName` and `FileSettings` |
| nRows | Row count of the real table |
| seed | Integer, default 42 |
| keepOriginalName | boolean (export naming) |
| columns | Ordered list of column entries, one per source column |

Contains only: category labels and counts, min and max, sentinel codes, quantiles, masks, repeat
structures, format settings, and unsupported-column names. It must never contain an ID value, free
text, a personal identifier, or a coordinate (FR-015, FR-019). See
`contracts/spec-file.schema.json`.

### GenerationRun *(memory)*

| Field | Description |
|---|---|
| seed | Integer |
| state | `idle`, `running`, `done`, `error`, `cancelled` |
| progress | Rows emitted, total rows |
| preview | First 50 fake rows (fake data, safe to show) |
| checks | List of CheckRow |

### CheckRow

| Field | Description |
|---|---|
| column | Name |
| metric | `label_counts`, `na_count`, `sentinel_counts`, `min`, `max`, `mean`, `sd`, `repeat_structure` |
| target | Value from the spec |
| achieved | Value measured from the generated table |
| pass | Exact metrics must be equal; mean and sd report a difference instead |

## Relationships

- A Spec has one FileSettings and many ColumnProfiles, in file order.
- A survey_id ColumnProfile has one IdMask.
- A GenerationRun is built from a Spec and a seed alone; it never reads the SourceTable.

## State transitions

**App flow**: `start` -> `ingest` (file chosen, settings confirmed) -> `profiling` -> `review` ->
`generate` -> `done`. Loading a spec jumps `start` -> `review`. Going back to an earlier step
keeps user overrides for columns whose name and type are unchanged, and recomputes the rest.

**Column status**: `ok` -> `needs_attention` when the profiler is unsure or the user edit is
invalid; `needs_attention` -> `ok` when resolved; any type -> `unsupported` when no in-scope type
fits or a typed date pattern fails to parse every non-NA value.

## Validation rules

- Column names in a loaded spec must be unique and non-empty, and every `type` must be known.
- `min <= max`; `sd >= 0`; `quantiles` has 101 non-decreasing values inside `[min, max]`.
- Category counts must sum to `nRows - naCount - sum(sentinels)`.
- `repeatStructure` must account for exactly the non-NA rows of the column.
- A date `format` must use only supported directives.
- Errors are reported by column name and the bad column cannot proceed (FR-018).
