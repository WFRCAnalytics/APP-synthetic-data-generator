# Data Model: JSON input and output

## JsonKind (one per top-level key, recorded in the spec as `json_kind`)

| Kind | Meaning | Written as |
|------|---------|------------|
| `number` | every non-null value was a JSON number | a JSON number |
| `string` | every non-null value was text, or the key mixed kinds (with a warning) | a JSON string |
| `boolean` | every non-null value was `true` or `false` | `true` or `false` |
| `null` | the key was always `null` (or its only values were null) | `null` |
| `object`, `array` | nested value: unsupported | omitted (default) or `null` in every record if kept |

Each description also records `nulls` (records where the key is `null`) and `missing` (records without
the key). `nulls + missing` plus the generated values equals the record count. A description holds no value,
range, statistic or nested key name.

## Unsupported reasons (fixed texts, new reason codes on a column)

`nested_object`, `nested_array`. Shown on the card as plain sentences naming the kind; the column is kept
by name and loaded as all-NULL. A mixed key is not unsupported: it carries the attention reason `mixed_kinds`.

## JSON source (in the spec)

| Field | Notes |
|-------|-------|
| `format` | `"json"` |
| `file_name` | as for the other sources |
| `form` | `"array"` or `"lines"` (one record per line) |
| `indent` | `"compact"`, `"2"`, `"4"` or `"tab"` (arrays only) |
| `line_ending` | `"lf"` or `"crlf"` |
| `trailing_newline` | boolean |
| `bom` | boolean |

`n_rows` is the spec's existing row count. No value, no text from inside a record.

## Column additions

`json_kind`, `json_nulls` and `json_missing` on every column of a JSON spec. `cell_format`, `stored_as_text`
and `parquet_type` do not apply.

## Written file

See [contracts/json-output.md](contracts/json-output.md).

## Validation

A JSON spec needs `json_kind` on every column that is written; the kind must agree with the column type
(a numeric type with `string` is refused, a text type with `number` is refused, a `date` column is `string`);
`nulls` and `missing` are whole numbers in `0..n_rows` and `nulls + missing <= n_rows`; `form` and `indent`
are from the closed sets; `indent` applies to arrays only. A CSV, Excel or Parquet spec with any `json_*`
field is refused.
