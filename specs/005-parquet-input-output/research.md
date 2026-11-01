# Research: Parquet input and output

## R1: How does the engine read Parquet? (spikes, 2026-11-01)

- **Decision**: With DuckDB's `parquet` extension, self-hosted exactly like `excel`: `fetch-extensions.mjs`
  downloads `parquet` for `wasm_eh` and `wasm_mvp` at build time into `public/duckdb-ext/`, the profile
  worker runs `LOAD parquet` from the site's repository before reading, and `read_parquet` is used on a
  registered file handle.
- **Evidence**: In the Node build of the pinned DuckDB-WASM, a pyarrow file of 5,000 rows and 14 columns
  read with snappy, gzip, zstd and no compression (`scripts/make-parquet-fixtures.py`). `DESCRIBE`
  gave `SMALLINT, BIGINT, UTINYINT, FLOAT, DOUBLE, DECIMAL(10,2), BOOLEAN, VARCHAR, DATE, TIMESTAMP,
  TIMESTAMP WITH TIME ZONE, VARCHAR[], STRUCT(...), MAP(...)`. `parquet_schema` gave the physical
  type, converted type, logical type (with bit width and signedness), type length, scale and
  precision, and repetition per column. A file that is not Parquet and a truncated one both fail with
  "No magic bytes found at end of file '<name>'" (names the file, nothing from inside it).
- **Correction found by the browser spike**: the first plan assumed Parquet was built in, because the Node
  build reads it (there `LOAD parquet` works offline; it is linked in). In the browser build it is not:
  with auto-loading off, `read_parquet` is "not in the catalog, but exists in the parquet extension",
  and with it on, the engine tries `https://extensions.duckdb.org/v1.5.4/wasm_eh/parquet.duckdb_extension.wasm`,
  which the content policy blocks (good: nothing leaves). The file exists for both builds, so it is
  self-hosted. Node tests call `LOAD parquet` (offline); the browser tests prove the hosted file loads.
- **Still to show in implementation**: the extension loading from the site under the strict policy and in
  the offline zip (T003 and the offline Parquet session), with zero requests outside the site.
- **Alternatives considered**: a JavaScript Parquet library (a new runtime dependency, a second
  reader to audit for leaks, slower on big files).

## R2: What may be queried (privacy)

- **Decision**: Only these, and nothing else: `DESCRIBE` of the read; `parquet_schema(file)` columns
  `name, type, converted_type, logical_type, type_length, scale, precision, repetition_type,
  num_children`; `parquet_file_metadata(file)` columns `num_rows, num_row_groups` only (never
  `created_by`); and `parquet_metadata(file)` columns `row_group_id, total_compressed_size,
  total_uncompressed_size` only (never `stats_*`, `min`, `max`, `bloom_filter_*`). `parquet_kv_metadata`
  is never called. A spy test records every row the engine returns while the file is loaded and
  profiled and fails on a planted marker.
- **Rationale**: FR-003, FR-009, FR-017. Row-group statistics and key-value text are real values in
  the footer. The engine uses statistics internally to read faster; that is not exposed.
- The logical-type text from the engine contains numbers only (bit width, scale), never data; it is
  parsed into a fixed description and the raw text is dropped.

## R3: Writing: own writer or the engine?

- **Decision**: Own streaming writer in `src/lib/parquet/`, used by the generate worker.
- **Rationale**: The generate worker works from the spec alone. The engine is 36 MB of wasm
  (`duckdb-eh.wasm`), would double table memory (rows into a table, then a copy), and would have to be
  kept away from any real data. A writer of PLAIN values is small and fully deterministic, which
  reproducibility (V) needs; DuckDB's output carries its own created-by, statistics and layout
  choices that change between versions.
- **What it writes**: magic `PAR1`; per row group, per column one data page (v1) holding RLE
  definition levels (when the column is optional) and PLAIN values, compressed with gzip; column
  metadata; a footer `FileMetaData` (version 1, schema, row groups, `created_by` =
  `"synthetic-data-generator <app version>"`, no key-value metadata, no statistics); footer length;
  `PAR1`. Row groups of up to 65,536 rows (configurable) bound memory.
- **Compression**: GZIP (Parquet's GZIP codec is the gzip format) through the browser's
  `CompressionStream("gzip")`, as the xlsx writer already uses deflate. Every common reader supports
  it. Gzip streams carry a header with a time field; the stream API writes zero, which keeps files
  deterministic (to be asserted in the writer test).
- **Alternatives considered**: engine `COPY TO` (above); snappy or zstd (no browser API; would need
  a port); uncompressed (a valid fallback, used if `CompressionStream("gzip")` is missing).

## R4: Type mapping

- **Decision**: One `ParquetType` description per top-level column, recorded in the spec:

| Kind | Physical + logical | Fields recorded |
|------|--------------------|-----------------|
| `int` | INT32/INT64 with Int(bitWidth, signed) | `bits` 8, 16, 32, 64; `signed` |
| `float` | FLOAT / DOUBLE | `bits` 32, 64 |
| `decimal` | INT32/INT64/FIXED_LEN_BYTE_ARRAY with Decimal(p, s) | `precision`, `scale` |
| `bool` | BOOLEAN | none |
| `string` | BYTE_ARRAY with String (UTF8) | none |
| `date` | INT32 with Date | none |
| `time` | INT64 with Time(unit) | `unit` ms, us, ns |
| `timestamp` | INT64 with Timestamp(unit, isAdjustedToUTC) | `unit`, `utc` |

  plus `nullable` for each. The writer chooses the physical type from the description (decimal:
  INT32 up to precision 9, INT64 up to 18, otherwise fixed-length bytes sized for the precision).
- **Unsupported** (column kept by name, loaded as all-NULL, reason shown): `list`, `struct`, `map`,
  `union`, `binary` (raw bytes), `uuid`, `interval`. Legacy 96-bit timestamps are read by the engine as
  timestamps and enumerations as strings, so both are supported. Reasons are fixed texts: "A list column", "A struct column", "A map column", "A binary column", and
  so on. Never a value.
- **Rationale**: FR-005, FR-006, FR-008, SC-001.

## R5: Conversion on load

- **Decision**: One typed `SELECT` into the all-text `src` table, the same shape as slice 3:
  integers and decimals `CAST AS VARCHAR` (exact), floats with `CAST AS VARCHAR` (shortest
  round-trip text), booleans `TRUE`/`FALSE`, dates `strftime('%Y-%m-%d')`, timestamps `strftime`
  to `YYYY-MM-DD HH:MM:SS[.ffffff]` in UTC (for a zone-aware column the engine's UTC rendering is
  used), times `HH:MM:SS`, strings as they are with empty text becoming the empty-text token, nulls
  NULL. Unsupported columns select `NULL`.
- **Rationale**: reuses the whole profiling, review, generation and check path (FR-004). Tested in
  Node against synthetic typed tables, as the Excel conversion is.

## R6: Writing values: from cell text to typed values

- **Decision**: `convert.ts` takes the rendered cell text the generator already makes (the CSV path's
  `render`) and the column's `ParquetType`, and returns a typed value or null: integers parsed and
  clamped to the width and sign, decimals scaled to the recorded scale and clamped to the precision,
  floats parsed, booleans from `TRUE/FALSE`, dates and timestamps from the ISO text to days or to
  the unit since the epoch, strings as UTF-8. NA tokens become null; the empty-text token becomes an
  empty string for string columns and null for others. A value that had to be clamped is counted and
  reported in the check table ("narrowed to the column's range").
- **Rationale**: FR-006, FR-007, acceptance scenario 2.4. One path for every column type, no change to
  the generators.

## R6b: Large numbers

- **Decision**: Conversion and writing use `BigInt` for 64-bit integers, unsigned 64-bit and decimals above 15
  digits; the generators keep working in doubles, so values for a column beyond 2^53 are drawn inside a
  safe range of its type and counted as narrowed in the check table.
- **Rationale**: exactness of what is written, honesty about what is generated (spec assumption).

## R7: Size limits

- **Decision**: Expanded size = sum of `total_uncompressed_size` over the row groups (from the footer,
  sizes only). Warn at 100 MB, stop above 1 GB, the same constants and messages as Excel (a file of about 500 MB of expanded data is the scale target, SC-005; the message states the expanded figure so a user is not surprised that a small compressed file is large once opened)
  (`WORKBOOK_STOP_BYTES`), with "Parquet" wording. The all-text table is larger than the file, so the
  estimate for memory is the same 2.5 times.
- **Rationale**: FR-013. Parquet compresses well, so the file size alone would under-warn.

## R8: Spec version 4

- **Decision**: `SPEC_VERSION` becomes 4; readers accept 1 to 4. Version 4 adds `source.format:
  "parquet"` (`file_name`, `row_groups`) and `parquet_type` on columns. A CSV or Excel spec is
  unchanged and writes its own format. The app version becomes 0.3.0.
- **Rationale**: Same approach as slices 2 and 3; FR-016.

## R9: Detection and refusals

- **Decision**: Detect by content: the first four bytes `PAR1` (and `PAR1` at the end). Everything
  else with a `.parquet` name is refused as "not a Parquet file". Truncated, empty (no rows or no
  columns) and encrypted (`PARE` magic) files get their own fixed messages (`parquet_damaged`,
  `parquet_empty`, `parquet_encrypted`, `parquet_not_parquet`, `parquet_too_large`). The engine's own
  message is never shown (it names the file; it is sanitized like the Excel errors).
- **Rationale**: FR-001, FR-015.

## R10: Footer of the fake file

- **Decision**: `created_by` is `synthetic-data-generator <app version>` (fixed string, no date),
  `key_value_metadata` absent, no `Statistics` on any column chunk, no bloom filters, no page index.
  A reader test opens the fake file with pyarrow and DuckDB and asserts exactly this.
- **Rationale**: FR-010, SC-002.

## R11: Browsers and offline

- **Decision**: The Parquet flow joins the Chromium, Edge, Firefox and WebKit matrix and the offline
  zip test (a Parquet session beside CSV and Excel). `CompressionStream("gzip")` exists in all four;
  the writer falls back to uncompressed pages and says so if it does not.
- **Rationale**: FR-018, Principle IV.

## Open items

None.
