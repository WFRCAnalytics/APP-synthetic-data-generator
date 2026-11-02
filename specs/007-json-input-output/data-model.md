# Data Model: JSON input and output

## JsonKind (one per top-level key, recorded in the spec as `json_kind`)

| Kind | Meaning | Written as |
|------|---------|------------|
| `number` | every non-null value was a JSON number | a JSON number |
| `string` | every non-null value was text, or the key mixed kinds (with a warning) | a JSON string |
| `boolean` | every non-null value was `true` or `false` | `true` or `false` |
| `null` | the key was always `null` (or its only values were null) | `null` |
| `object`, `array` | nested value: unsupported | omitted (default) or `null` in every record if kept |

Each description also records `json_missing` (records without the key). The records where the key is `null`
are the other missing values (the column's NA count minus `json_missing`), so null and absent are kept apart
without a second number. A description holds no value, range, statistic or nested key name.

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

`json_kind` and `json_missing` on every column of a JSON spec. `cell_format`, `stored_as_text`
and `parquet_type` do not apply.

## Written file

See [contracts/json-output.md](contracts/json-output.md).

## Validation

A JSON spec needs `json_kind` on every column that is written; the kind must agree with the column type
(a `string` key may have any type; a `number` key may not be a date, personal or free-text column; a `boolean` key is a yes or no or a category; a `null` key is an empty column; a nested key is unsupported);
`json_missing` is a whole number no larger than the column's count of missing-value cells; `form` and `indent`
are from the closed sets; `indent` applies to arrays only. A CSV, Excel or Parquet spec with any `json_*`
field is refused.
