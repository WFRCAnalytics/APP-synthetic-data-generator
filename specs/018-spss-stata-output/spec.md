# Feature Specification: SPSS and Stata output

**Status**: Complete

When the real file was an SPSS (.sav) or Stata (.dta) file, the fake table is downloaded as the same kind of file by default.
CSV is the other choice (Generate, "File type"). The files are written by the app's own writers (`src/lib/stat/`), in the page, from
the finished fake CSV: DuckDB's `stats_duck` writes SPSS but not Stata, and one code path for both is simpler to test.

- **FR-001**: Columns the spec types as integer or float become numbers (a categorical column whose cells are all numbers does too);
  date, datetime and time become SPSS dates or Stata `%td`/`%tc` values; every other column is text. A column whose cells do not all fit
  its type is written as text, so nothing is lost or invented.
- **FR-002**: Blank cells are system-missing numbers or empty text. No value labels, variable labels or notes are written.
- **FR-003**: Variable names the format cannot take are made valid and kept unique. Text longer than the format holds (255 bytes for
  SPSS, 2,045 for Stata) is cut at a character boundary.
- **FR-004**: The same table and seed give the same bytes. Both files are read back with an independent reader (pyreadstat) in tests.
- **FR-005**: The README for agents says the file is an SPSS or Stata file. The spec records the table as CSV (the format of the run).
- **FR-006**: Nothing leaves the device.

## Assumptions

- Out of scope: SAS files, value labels, writing .sav or .dta for tables read from other formats, and other output types for CSV,
  Excel, Parquet or JSON uploads (they keep writing their own kind; a Design table can already choose its type).
