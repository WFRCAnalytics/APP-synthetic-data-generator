# Data Model: Parquet input and output

## ParquetType (one per top-level column, recorded in the spec as `parquet_type`)

| Field | Type | Applies to | Notes |
|-------|------|------------|-------|
| `kind` | `int`, `float`, `decimal`, `bool`, `string`, `date`, `time`, `timestamp` | all | closed set |
| `bits` | 8, 16, 32, 64 | `int`; 32, 64 for `float` | |
| `signed` | boolean | `int` | |
| `precision` | 1 to 38 | `decimal` | |
| `scale` | 0 to precision | `decimal` | |
| `unit` | `ms`, `us`, `ns` | `time`, `timestamp` | |
| `utc` | boolean | `timestamp` | true when the real column was adjusted to UTC (a time-zone-aware column) |
| `nullable` | boolean | all | false when the real column was required |

Rules: a description holds no value, range, statistic or name from inside the file. The writer derives the physical type from it (research R4).

## Unsupported reasons (fixed texts, new reason codes on a column)

`nested_list`, `nested_struct`, `nested_map`, `nested_union`, `binary`, `uuid`, `interval`. Shown on the card as plain sentences naming the kind; the column is kept by name and loaded as all-NULL.

## Parquet source (in the spec)

| Field | Notes |
|-------|-------|
| `format` | `"parquet"` |
| `file_name` | as for the other sources |
| `row_groups` | number of row groups of the real file (structure only) |

`n_rows` is the spec's existing row count. No `created_by`, key-value text, compression or statistics.

## Column additions

`parquet_type` (above) on every column of a Parquet spec. `cell_format` and `stored_as_text` do not apply.

## Written file

See [contracts/parquet-output.md](contracts/parquet-output.md).

## Validation

A Parquet spec needs `parquet_type` on every column that is written; the type description must be consistent with the column type (an `int` description with a `categorical` column of integer storage is fine, a `string` description with a numeric column is refused); `scale <= precision`; `bits` in the allowed set. A CSV or Excel spec with `parquet_type` is refused.
