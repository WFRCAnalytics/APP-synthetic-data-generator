# Research: JSON input and output

## R1: How does the engine read JSON? (spike, 2026-11-02, Node build of the pinned engine)

- **Decision**: DuckDB's `json` extension, self-hosted like `excel` and `parquet`: `fetch-extensions.mjs`
  adds `json` to its list, downloads it for `wasm_eh` and `wasm_mvp` into `public/duckdb-ext/`, and the
  profile worker runs `LOAD json` from the site's repository before reading.
- **Evidence**: `json.duckdb_extension.wasm` exists on the official host for both builds (HTTP 200). In
  the Node build `LOAD json` works offline (linked in; the browser build needs the file, as R1 of slice 5
  found for Parquet). `read_json_objects(file, format='auto')` counted 3 records for a pretty-printed
  array and for the same records one per line, 2 for CRLF and blank-line files, 0 for `[]`, 1 for a file
  with a byte-order mark, and 200,000 records of 8 MB in 63 ms.
- **Still to show in implementation**: the extension loading from the site under the strict policy and in
  the offline zip, with zero requests outside the site (the first task spike and the offline session).
- **Alternatives considered**: `JSON.parse` in the worker (memory about 5 to 8 times the file, so it cannot
  meet the 500 MB target, and a second parser to audit for leaks).

## R2: What may be queried (privacy)

- **Decision**: Record text is read only as whole JSON values inside the engine. The questions asked of it
  return structure only: `count(*)`; `json_keys(json)` (key names of the top level, never nested ones);
  `json_type(json, path)` (a type name); `json_exists(json, path)` (a boolean). The values themselves
  leave the engine only in the load into the all-text table (`json_extract_string`), which stays inside
  the profile worker exactly as the CSV load does. A spy test records every result row returned to the
  page while a file is loaded and profiled and fails on a planted marker.
- **Errors**: the engine's messages name the file and a byte offset and, for some failures, quote the first
  character of the file (`first character is '{'`). They are never shown: each failure maps to a fixed
  message (R6). The registered file name is a fixed internal name, not the user's file name.
- **Nested key names**: `json_keys` is called on the record only; the keys of an object value are never
  requested, so the spec cannot hold them.

## R3: Key order, null versus missing, mixed kinds (spike)

- **Key order**: `json_keys(json)` returns a record's keys in file order, and a repeated key appears twice
  (`["a","a"]` for `{"a":1,"a":"..."}`), so duplicates are detected by comparing the count with the
  distinct count and refused (FR-014). First-seen order across the file is the key's first record and, in
  it, its position: `arg_min(position, row_number)` per key (a plain `min(position)` is wrong when keys
  shift between records; the spike showed it).
- **Types**: `json_type(json, '$."key"')` returned `UBIGINT`, `BIGINT`, `DOUBLE`, `VARCHAR`, `BOOLEAN`,
  `NULL`, `ARRAY` or `OBJECT`. Counting per key and type gives: all numbers (integer or decimal),
  all text, all boolean, null-only, nested, or mixed. Integer and decimal numbers together are one
  numeric kind. Anything else mixed is text with a warning.
- **Null versus missing**: `json_exists(json, '$."key"')` is true for a present key whose value is `null`
  and false for an absent one. The spike returned 1 missing and 1 null for the same key in 3 records.
- **Number text**: `json_extract_string` returns the engine's rendering, not the file's text: `1.50`
  gives `1.5`, `1e5` gives `100000.0`, `2.5E-3` gives `0.0025`, an integer above 2^63 is kept exactly
  (`12345678901234567890`). The load removes a trailing `.0` from a number the engine typed `DOUBLE`
  when its value is whole, so a column of whole numbers written as `1e5` is not mistaken for a decimal.
  Trailing zeros of a decimal (`1.50`) are not recoverable from the engine; the recorded decimal places
  are the most seen in the rendering. This is a known limit, listed in the spec's assumptions as "equivalent,
  not identical" and shown in the quickstart.
- **Strings**: escapes and non-ASCII text come back decoded (`café 😀`); the empty string is not NULL.

## R4: Form, layout and formatting detection

- **Decision**: From a bounded head (the first 64 KB) and tail (the last 4 KB) of the file read as bytes,
  without parsing records:
  - byte-order mark: the first three bytes;
  - form: first non-space character `[` means array; `{` means one record per line (confirmed by the
    engine's own detection reading the same count); anything else is refused;
  - line ending: the first line break (`\n` or `\r\n`);
  - trailing newline: whether the file ends with a line break;
  - indent: for an array, the whitespace that starts the line after the first `{` (a tab, 2 or 4 spaces;
    other widths and one-line arrays are written compact).
  These are formatting only; no byte of a value is kept.
- **Rationale**: the engine does not report layout, and reading a bounded head and tail is cheap and
  cannot leak a value because only whitespace and one bracket character are inspected.
- **Alternatives considered**: always writing compact (breaks diffs and surprises people who open the file);
  copying the real layout whole (not possible without values).

## R5: Writer

- **Decision**: Own streaming writer in `src/lib/json/`, used by the generate worker.
- **What it writes**: the optional byte-order mark; for an array `[`, the records separated by commas
  (each on its own line with the recorded indent, or all on one line when compact), `]`; for one record
  per line, each record then the recorded line ending; the trailing newline as recorded. Keys are the
  recorded names in order; a key recorded as sometimes missing is omitted from exactly the recorded
  number of records, and a key recorded as sometimes `null` is `null` in exactly that many. Which records
  those are is chosen by the key's own sub-seeded generator (so changing one key does not move another's).
- **Value tokens**: number (the rendered text if it is a valid JSON number, else narrowed and noted), text
  (JSON-escaped with `\uXXXX` only for control characters; other characters written as they are, UTF-8),
  true or false, `null`. Non-finite numbers cannot occur (generators are bounded).
- **Rationale**: same as slices 3 and 5 (R3 of slice 5): the generate worker is engine-free, deterministic
  and small; the JSON grammar is tiny.
- **Alternatives considered**: engine `COPY TO` (above), `JSON.stringify` per record (it writes `undefined`
  keys as omitted, which is what is wanted, but gives no indent control per recorded layout without
  reformatting; a thin hand-written layout is simpler to test for byte equality).

## R6: Fixed error messages

- **Decision**: new codes with fixed text, none built from the engine's message: `json_empty` (no records),
  `json_not_records` (the top level is not a list of records, or an item is not a record), `json_malformed`
  (damaged or truncated), `json_duplicate_key` (a record repeats a key), `json_too_large`, `json_unsupported_form`
  (GeoJSON-like, comments, JSON5). The engine message is discarded (it is logged nowhere).
- Detection of "GeoJSON, JSON5 and comments": these fail to parse as strict JSON, so they surface as
  `json_malformed` with the message "This is not plain JSON. GeoJSON, JSON5 and files with comments are not
  supported."

## R7: Size and memory

- **Decision**: the Excel and Parquet rule: warn above 100 MB of expanded data and stop above 1 GB, with the
  estimate from the file size (a JSON file expands to the in-memory text table at about 1 to 1.5 times its
  size, because keys are not repeated in the table). The same warning component and wording as CSV.

## R8: Spec version and older specs

- **Decision**: the spec version moves from 4 to 5. The project is in beta before 1.0.0, so the readable
  list is cut to `[5]` in one cleanup task; the tests that load version 1 to 4 specs are removed with it.
  A spec of another version is refused with the existing "made by another version" message.
- **Rationale**: the user's instruction, and fewer code paths to keep correct across four formats.

## R9: Results (2026-11-02)

- **Bundle**: no new runtime dependency. The JSON reader is one more file in `public/duckdb-ext/` (about 1 MB per
  build, two builds); the app's own JavaScript grew by the detection, kinds, conversion and writer code (about 4 KB
  gzipped).
- **Audit**: the engine's worker logs the errors it raises to the console, and for JSON such a line names a position in
  the file (`at byte 31 in record/value 2`). It is not a value, but the worker's console is now silenced before its own
  script runs (`patchedWorkerSource`), and `tests/e2e/json-privacy.spec.ts` checks the console for markers and engine text.
- **Key order**: a plain `min(position)` per key gives the wrong order when keys shift between records; the first record
  that has the key and the key's position in it (`arg_min(pos, rn)`) is right and tested (`nulls_missing.json`, whose
  first record lacks one key).
- **Number text**: the engine renders numbers itself (`1.50` is `1.5`, `1e5` is `100000.0`); a whole double has its `.0`
  removed. Trailing zeros of a decimal are not recoverable and the fake file writes plain notation.
- **Scale (SC-006)**: a 500 MB file of 7.2 million records (one per line, five keys) on the reference laptop:
  profile 69.9 s, generate and write 47.4 s, worst frame delay 5.8 ms, all 15 checks passed.
- **Browsers**: Chromium, Edge, Firefox and WebKit run `json-flow`, `json-privacy` and `json-extension`; the offline zip
  runs a JSON session that matches the hosted build byte for byte.
- **Open**: SC-009 (a person reaching Review in under 2 minutes without instructions) needs a person.
