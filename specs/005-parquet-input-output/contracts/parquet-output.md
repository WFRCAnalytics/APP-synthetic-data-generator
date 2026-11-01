# Contract: the fake Parquet file

| Part | Content |
|------|---------|
| Magic | `PAR1` first and last |
| Schema | one required or optional leaf per written column, in the spec's order, names as in the spec, types from `parquet_type` (logical annotations included) |
| Row groups | up to 65,536 rows each, one data page (v1) per column chunk, PLAIN values, RLE definition levels for optional columns, GZIP |
| Nulls | real nulls; their count equals the spec's NA count (required columns have none) |
| Footer | `version` 1, `num_rows`, `created_by` = `synthetic-data-generator <app version>` |
| Absent | key-value metadata, column statistics, bloom filters, page index, dictionary pages, sorting columns |

Values are inside the type's range (clamped when needed; the number narrowed is reported in the check table). The same spec and seed give the same bytes. Unsupported columns are not written unless the user keeps them: then they are written as an optional string column of nulls under the same name (the real nested type is not reproduced).
