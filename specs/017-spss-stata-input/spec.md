# Feature Specification: SPSS and Stata input

**Status**: Complete

An analyst can choose an SPSS (.sav, .zsav) or Stata (.dta) file. The app reads it in the browser with the `read_stat` function of the
`stats_duck` DuckDB community extension, self-hosted like the Excel, Parquet and JSON readers (fetched at build time, no download at run
time). Only structure is shown first (row count, variable names, a kind for each). The file is then profiled exactly like a CSV and the
fake file is written as a CSV with the same variables in the same order.

- **FR-001**: A file is recognised by its first bytes (`$FL2`/`$FL3`, `<stata_dta>`, or an old Stata release byte with a `.dta` name).
- **FR-002**: Real values and value or variable labels are never shown; errors are fixed messages.
- **FR-003**: Whole numbers read as `1000`, not `1000.0`; dates as ISO text; missing values as blank. Value labels are not read.
- **FR-004**: Output is a CSV (UTF-8, comma, header); writing SPSS or Stata files is out of scope.
- **FR-005**: Files whose data would exceed the memory limit are refused as with Parquet; large ones get the size warning.
- **FR-006**: Nothing leaves the device; the only new request is the extension file from the site itself.

## Why stats_duck and not read_stat

DuckDB's separate `read_stat` community extension loads in the browser but crashes ("memory access out of bounds") as soon as it
reads a file, with a registered file or a buffer. `stats_duck` provides the same `read_stat` function and works in both WebAssembly builds.
It is a larger toolkit (about 1 MB); only `read_stat` is used.

## Assumptions

- Out of scope: SAS files, value labels as a codebook, writing .sav or .dta, nested data.
