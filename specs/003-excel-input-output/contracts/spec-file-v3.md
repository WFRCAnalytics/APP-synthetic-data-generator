# Contract: Spec File Version 3 and Worker Messages for Excel

**Feature**: 003-excel-input-output. Amends the slice 1 and 2 contracts.

## 1. Spec file

`spec_version` is `3`; readers accept `1`, `2` and `3`; a higher version gets the newer-version
message. The authoritative JSON schema stays in
`specs/001-csv-synthetic-slice/contracts/spec-file.schema.json` and gains the `xlsx` source and
`cell_format` (updated by task).

```json
{
  "spec_version": 3,
  "source": {
    "format": "xlsx",
    "file_name": "survey.xlsx",
    "sheet": "Survey Data",
    "range": "A3:I203",
    "skip_rows": 2,
    "header": true,
    "date1904": false
  },
  "n_rows": 200,
  "seed": 42,
  "columns": [
    { "name": "amount", "type": "float", "cell_format": "#,##0.00", "mode": "match_shape", "min": 1000, "max": 3487.5, "decimals": 2, "quantiles": ["..."] },
    { "name": "when", "type": "date", "cell_format": "mm/dd/yyyy", "format": "%Y-%m-%d", "granularity": "day", "mode": "uniform", "min": 19723, "max": 20314 },
    { "name": "zip", "type": "short_string", "cell_format": "@", "pattern": ["digit", "digit", "digit", "digit", "digit"], "length_groups": { "5": 200 }, "repeat_structure": { "1": 200 } },
    { "name": "flag", "type": "boolean", "na": { "tokens": ["", "\u0001"], "count": 24, "by_token": { "": 10, "\u0001": 14 } }, "counts": { "N": 90, "Y": 86 } }
  ]
}
```

- `source` for `xlsx` must not carry `encoding`, `delimiter`, `quote`, `quote_style`, `line_ending`,
  `bom`, `trailing_newline` or `header_quoted`; for `csv` it must not carry `sheet`, `range`,
  `skip_rows` or `date1904`.
- `cell_format` follows the rules in `data-model.md`. It never holds a value.
- The token `"\u0001"` in `na.tokens` means empty text; `""` means a blank cell.

## 2. Profile worker: new messages

| Message | Direction | Payload | Meaning |
|---|---|---|---|
| `inspectWorkbook` | page to worker | `file: File` | Read the workbook package's metadata only |
| `workbookInfo` | worker to page | `WorkbookInfo` (names, hidden flags, expanded sizes, date system) | No cell value |
| `inspectSheet` | page to worker | `sheet: string` | Hints for one sheet |
| `sheetHints` | worker to page | `SheetHints` | Suggested rows to skip, format codes, merged cells flag |
| `loadSheet` | page to worker | `{ sheet, range?, skipRows, header }` | Load the chosen sheet into the all-text table (replaces `load` for workbooks) |

`loaded`, `progress`, `columnProfile`, `profiled` and `error` are unchanged. Errors follow the
slice 1 rule: a message may name a sheet, a column and a row number, never a cell value.

## 3. Generate worker

`generate` accepts a spec whose source is `xlsx` and replies with `chunk` messages that hold the
bytes of the .xlsx (zip) as they are produced; `done` carries the total size. The `preview` rows are
the same text values as for CSV.

## 4. Extension files

Served at `<site>/duckdb-ext/<engine version>/<platform>/excel.duckdb_extension.wasm`, where the
platform is `wasm_eh` or `wasm_mvp`. `VERSION.json` in `duckdb-ext/` lists the files and sha-256 sums.
