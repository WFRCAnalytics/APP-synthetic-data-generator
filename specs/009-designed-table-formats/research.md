# Research: File formats for designed tables

## R1: Results (2026-11-02)

- **Design**: no new spec version or dependency. A design has an `output` (csv, xlsx, parquet, json, ndjson); `specFromDesign` builds the
  matching source and the per-column fields the writers need (`cell_format` for the workbook, `parquet_type`, `json_kind`), and the
  existing validator accepts the result. The CSV design is unchanged (no extra fields).
- **Mappings**: workbook formats `0`, `0.00..`, `yyyy-mm-dd`, `yyyy-mm-dd hh:mm:ss`; the sheet is named after the table with `[ ] : * ? / \`
  replaced and cut to 31 characters; Parquet whole numbers take the smallest signed width that holds the range (8, 16, 32 or 64),
  decimals a 64-bit float, dates a date, moments a microsecond timestamp, everything else a string; JSON numbers are numbers, a yes or no
  with plain labels (yes/no, y/n, true/false, t/f) is `true` or `false`, everything else is text. Missing values are `null` in JSON.
- **Tests**: 20 integration tests read each format back (engine for Parquet, a parser for JSON, the workbook's XML), 2 component tests,
  3 end-to-end tests including a Parquet spec that loads again in a fresh session to the same bytes. Unit suite: 1,905 pass.
- **Browsers**: design-flow and a11y pass in Chromium, Edge, Firefox and WebKit (42 tests).
- **Not done**: choosing the JSON indent, Parquet compression or several sheets (out of scope).
