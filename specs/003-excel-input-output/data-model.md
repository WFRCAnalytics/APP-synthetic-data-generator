# Data Model: Excel Input and Output

**Feature**: 003-excel-input-output. Extends the slice 1 and 2 data models.

## Spec file, version 3

`spec_version` is 3 (readers accept 1, 2 and 3).

### source (format xlsx)

| Field | Type | Meaning |
|---|---|---|
| `format` | `"xlsx"` | A CSV spec has `"csv"` and is unchanged |
| `file_name` | string | Original file name |
| `sheet` | string | Sheet name, exactly as in the workbook (spaces and accents kept) |
| `range` | string, optional | Cell range of the table, such as `A3:I203`; absent means the used range from `skip_rows` |
| `skip_rows` | integer >= 0 | Empty or title rows above the header; written empty in the fake sheet |
| `header` | boolean | The first row of the range holds column names |
| `date1904` | boolean | The workbook uses the 1904 date system |

`encoding`, `delimiter`, `quote` and the other CSV fields do not apply and are rejected on an xlsx
source. The rule is the other way too: CSV fields stay required for `csv`.

### column additions

| Field | Type | Meaning |
|---|---|---|
| `cell_format` | string, optional | The number format code of the column's cells, such as `#,##0.00`, `0.0%`, `mm/dd/yyyy`, `@` for text. Never a value |

Allowed on every type that is written as cells; ignored for CSV output. Validation: at most 255
characters; no control characters; for `date`, `datetime` and `time` columns it must be a date or
time code; for `integer` and `float` it must be a number, percent, currency or scientific code;
`@` is allowed only on `categorical`, `boolean`, `survey_id`, `personal`, `free_text` and
`short_string`, and on numeric-looking text columns kept as text.

### NA tokens

`na.tokens` may include `EMPTY_TEXT_TOKEN` (the single character U+0001 written as `"\u0001"`),
which stands for a cell that holds empty text. The empty token `""` still stands for a blank cell.
`by_token` counts them separately, so blank and empty text are reproduced in the same numbers.

## Workbook information (worker to page, no cell value)

```text
WorkbookInfo {
  sheets: { name: string; hidden: boolean; veryHidden: boolean; expandedBytes: number }[]
  date1904: boolean
  defaultSheet: string          // the first visible sheet
}
SheetHints {
  suggestedSkipRows: number
  columnCount: number           // from the dimension and the header row
  mergedCells: boolean | "not_checked"
  formats: string[]             // one format code per column (never values)
  expandedBytes: number
}
```

## Profile additions

`ColumnProfile.cellFormat?: string` (from `SheetHints.formats`, editable). New reason codes:
`merged_cells`, `format_mismatch` (a column whose cells carry different format codes, so the first
was used), `sheet_hidden`. `FileSettings` is replaced by a `SourceSettings` union with the CSV
settings and the Excel settings.

## Writer entities (pure TypeScript)

- **Zip writer**: entries streamed with data descriptors; CRC-32 and sizes computed while writing.
- **Style table**: one `xf` per distinct format code, in first-use order; style 0 is general.
- **Cell**: `{ kind: "n" | "s" | "e"; value }` built from a generated text value and the column's
  kind (date text to serial, number text to number, text as inline string, empty-text token as an
  empty inline string, NA tokens other than the two as text).

## Transitions

CSV source to xlsx source: choosing a different file replaces the session as in slice 1.
A loaded spec decides the output format by its `source.format`.
