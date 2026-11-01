# Contract: spec file version 4

Readers accept versions 1 to 4. The app writes 4. Everything in versions 1 to 3 is unchanged.

## Source

```json
{ "format": "parquet", "file_name": "survey.parquet", "row_groups": 3 }
```

Only these three fields. The row count is `n_rows`.

## Column addition

```json
{ "name": "amount", "type": "float", "...": "...", "parquet_type": { "kind": "decimal", "precision": 10, "scale": 2, "nullable": true } }
```

```json
{ "name": "when", "type": "datetime", "...": "...", "parquet_type": { "kind": "timestamp", "unit": "us", "utc": true, "nullable": false } }
```

## Must not appear anywhere in the file

Cell values; key-value metadata; `created_by` of the real file; row-group or column statistics (minimum, maximum, null counts of a row group); dictionary content; bloom filters; the compression of the real file; nested values.
