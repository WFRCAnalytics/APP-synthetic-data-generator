# Tasks: Parquet input and output

**Input**: Design documents from `/specs/005-parquet-input-output/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/spec-file-v4.md, contracts/parquet-output.md, quickstart.md

**Tests**: Included. The constitution (Principle VIII) requires tests for generators, validation and detection; the spec requires leak, request and read-back tests (FR-009, FR-010, FR-017, SC-001, SC-002). Write each test first and see it fail.

**Organization**: By user story. Stories 1, 2 and 4 are P1; story 3 is P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 file in and fake file out, US2 types survive, US3 nested and unusual columns, US4 nothing real is kept
- Paths are from the repository root

---

## Phase 1: Setup

- [x] T001 Bump `package.json` to `0.3.0`; set `SPEC_VERSION` to 4 and `READABLE_SPEC_VERSIONS` to `[1, 2, 3, 4]` in `src/lib/spec/types.ts` and update the tests that pin the version (`tests/unit/spec-roundtrip.test.ts`, slice 1 to 4 tests that expect 3, `tests/component/version-display.test.tsx` reads it)
- [x] T002 [P] Extend `scripts/make-parquet-fixtures.py` into the full fixture set under `tests/fixtures/parquet/`: the existing types file in four codecs, `plain.parquet`, a file with required (non-null) columns, `wide.parquet` (300 columns), `empty.parquet` (zero rows), `encrypted.parquet` (`PARE` magic), `unsupported_scalars.parquet` (binary, uuid, interval), `names.parquet` (empty and duplicated column names), `markers.parquet` (planted `PRIVATE-MARKER` in data, key-value metadata, created-by and statistics), `not_parquet.parquet`, `truncated.parquet`; commit the small outputs
- [x] T003 Self-host the Parquet reader like Excel: add `parquet` to `EXTENSIONS` in `scripts/fetch-extensions.mjs`; generalize `src/lib/duckdb/extension.ts` to `loadExtension(run, repositoryUrl, name)` (keep `loadExcelExtension`) and test it in `tests/unit/engine-extension.test.ts`; add `duckdb-ext/*/wasm_eh/parquet.duckdb_extension.wasm` and the `wasm_mvp` one to `REQUIRED_FILES` in `scripts/verify-release.mjs` and its test; record the new size (research R1)
- [x] T003a [P] Browser smoke test `tests/e2e/parquet-extension.spec.ts`: in the built app under the strict content policy, load `parquet` from the site (`parquetSmoke` in `src/spikes/main.ts`), read `plain.parquet`, expect the row count, column names and row-group count, zero policy violations, zero requests outside the site and one request for the hosted `parquet.duckdb_extension.wasm`; wire into `.github/workflows/deploy.yml` and `release.yml` after the build

---

## Phase 2: Foundational (blocks all stories)

- [x] T004 [P] Unit tests for `ParquetType` in `tests/unit/parquet-types.test.ts`: validation of each kind and field range, the physical type chosen for each description (decimal INT32 up to precision 9, INT64 up to 18, fixed bytes above), integer ranges by width and sign, decimal ranges by precision, equality and formatting for the UI
- [x] T005 [P] Unit tests for schema mapping in `tests/unit/parquet-schema.test.ts`: DuckDB type text plus a `parquet_schema` row to `ParquetType` for every type in the fixture (int8 to int64, uint8 to uint64, float, double, decimal, bool, string, date, time, timestamp with and without zone, nanosecond units), `nullable` from repetition, and each unsupported kind (list, struct, map, union, binary, uuid, interval) with its fixed reason code; the raw logical-type text is never kept
- [x] T006 [P] Unit tests for the Thrift compact writer in `tests/unit/parquet-thrift.test.ts`: varints and zigzag, field headers with and without deltas, nested structs and lists, strings and binary, against byte vectors known from the Thrift compact specification
- [x] T007 [P] Unit tests for value encoding in `tests/unit/parquet-encode.test.ts`: PLAIN for each physical type (little endian ints, floats, byte arrays with length prefix, fixed-length decimals in two's complement, bit-packed booleans), RLE and bit-packed definition levels for a column with nulls, a column without nulls
- [x] T008 [P] Unit tests for conversion in `tests/unit/parquet-convert.test.ts`: rendered text to typed value for each kind, clamping into the integer width and decimal precision with a count of narrowed values, ISO date and timestamp to days and to each unit (including before 1970), NA tokens to null, the empty-text token to an empty string for strings and null otherwise, an unparseable value to null with a count, and 64-bit, unsigned 64-bit and 38-digit decimal values exact through `BigInt` (research R6b)
- [x] T009 Implement `src/lib/parquet/types.ts` and `src/lib/parquet/schema.ts` to pass T004 and T005
- [x] T010 Implement `src/lib/parquet/thrift.ts` and `src/lib/parquet/encode.ts` to pass T006 and T007
- [x] T011 Implement `src/lib/parquet/convert.ts` (exact `BigInt` for 64-bit and wide decimals) to pass T008
- [ ] T012 [P] Add the `parquet_*` error codes with fixed messages in `src/lib/errors.ts` (`parquet_not_parquet`, `parquet_damaged`, `parquet_empty`, `parquet_encrypted`, `parquet_too_large`, `parquet_unavailable`) and make `sanitizeError` map the engine's "No magic bytes" and "Invalid Input" messages for a Parquet read to them; test in `tests/unit/errors.test.ts`
- [ ] T013 [P] Spec version 4 in `src/lib/spec/types.ts`, `validate.ts`, `build.ts`, `toProfiles.ts` and `specs/001-csv-synthetic-slice/contracts/spec-file.schema.json`: the `parquet` source variant, `parquet_type` on columns, validation per `data-model.md`, readers accept 1 to 4; tests in `tests/unit/spec-validate-parquet.test.ts` and `tests/unit/spec-roundtrip.test.ts`

**Checkpoint**: types, encoding, conversion and the spec format exist and are tested.

---

## Phase 3: User Story 1 - A Parquet file in, a fake Parquet file out (Priority: P1) 🎯 MVP

**Goal**: choose a Parquet file, see its structure, profile like a CSV, generate and download a fake `.parquet` that two independent readers open.

**Independent Test**: `npx playwright test parquet-flow` and `npx vitest run parquet-load parquet-readback`.

- [ ] T014 [P] [US1] Integration test `tests/integration/parquet-load.test.ts` (Node engine): registering each fixture codec, `inspectParquet` returns row count, column names, types and row-group count, and `loadParquet` builds the all-text `src` table whose profile types match (ints, decimals, dates, timestamps, booleans, strings, empty text versus null)
- [ ] T015 [P] [US1] Read-back test `tests/integration/parquet-readback.test.ts`: write a file with `writeParquet` from a synthetic spec and read it with the Node engine (`read_parquet`, `parquet_schema`) and, when pyarrow is available, with pyarrow (skipped otherwise): same names, order and types, null counts equal the spec's, values inside the type's range, every codec setting used
- [ ] T016 [P] [US1] Unit tests `tests/unit/parquet-writer.test.ts`: file layout (magic, footer length), row groups split at the chosen size, gzip pages deterministic (same bytes twice), nullable and required columns, empty-string versus null, a column of every kind, footer `created_by`, no key-value metadata and no statistics fields present
- [ ] T017 [US1] Implement `src/lib/parquet/writer.ts` (streaming, row groups, gzip through `CompressionStream` with an uncompressed fallback that reports itself) to pass T016 and T015
- [ ] T018 [US1] Implement `src/workers/profile/parquet.ts`: `inspectParquet` (queries listed in research R2 only) and `loadParquet` (the typed to all-text conversion of research R5, unsupported columns as NULL; empty and duplicated column names renamed on the CSV header rules and the rename shown), with the size estimate from `total_uncompressed_size`; to pass T014
- [ ] T019 [US1] Worker and protocol: detect a Parquet file by its first four bytes in `src/workers/profile.worker.ts`, add `inspectParquet`/`parquetInfo` messages to `src/workers/protocol.ts`, set `ColumnProfile.parquetType` for each column, and keep the all-text path for the rest
- [ ] T020 [US1] Generation: `src/lib/generate/parquet.ts` (`parquetLayoutOf(spec)`, `writeParquet(spec, seed, chunkRows, observe, between)` using the CSV path's rendering and `convert.ts`), the Parquet source in `src/lib/generate/table.ts`, and the `generateParquet` path in `src/workers/generate.worker.ts`; narrowed-value counts go to the check table
- [ ] T021 [US1] App: `src/app/session.ts` (file kind, `fakeBlob` mime `application/vnd.apache.parquet`, `.parquet` file name with `_fake`), `src/features/ingest/IngestScreen.tsx` accepts `.parquet` and shows a structure card (`ParquetSummary.tsx`: row count, column count, row groups, column names with their types), the size warning in `sizeWarnings.ts` (reuse the Excel thresholds, "Parquet" wording), `src/App.tsx` wiring
- [ ] T022 [P] [US1] Component test `tests/component/parquet-ingest.test.tsx`: the card shows names, types and counts and no value; the size warning and stop (the message gives the expanded figure); the file name and the compression shown on Generate; choosing several files or a folder gets the one-file-at-a-time message
- [ ] T023 [P] [US1] End-to-end test `tests/e2e/parquet-flow.spec.ts`: choose a fixture, review, generate, download, then read the download with pyarrow and with the app's own engine and compare schema; same seed gives the same bytes; zero outside requests

**Checkpoint**: a Parquet round trip works through the app.

---

## Phase 4: User Story 2 - Types that survive the round trip (Priority: P1)

**Goal**: every supported logical type, nullability and range is kept.

**Independent Test**: `npx vitest run parquet-readback` with the all-types fixture, and `npx playwright test parquet-flow`.

- [ ] T024 [P] [US2] Extend `tests/integration/parquet-readback.test.ts` to compare schema column by column against the real fixture for int8 to int64, uint8 to uint64, float32, float64, decimal(10,2) and (38,10), bool, string, date, time ms/us, timestamp ms/us/ns with and without UTC, required columns, and a column with missing values
- [ ] T025 [P] [US2] Range tests in `tests/unit/parquet-convert.test.ts` and an end-to-end check in `tests/e2e/parquet-flow.spec.ts`: an int16 column never leaves its range, a decimal never exceeds its precision, a whole-number column stays an integer type, the check table reports how many values were narrowed
- [ ] T026 [US2] Carry types through profiling and the spec: `src/lib/spec/build.ts` and `toProfiles.ts` write and read `parquet_type`, `src/workers/profile.worker.ts` keeps it through re-profiling and type overrides, and the card shows the file type beside the column type (`src/features/review/ColumnCard.tsx`)
- [ ] T027 [US2] Make the writer follow the type description when the user changes a column's profiled type (integer to categorical, decimal to text): the description decides the physical type; a change that makes the two inconsistent is refused in Review with a plain message (`src/features/review/ColumnEditors.tsx`, validation rule in `validate.ts`)

**Checkpoint**: schemas read back identically.

---

## Phase 5: User Story 4 - Nothing real is kept (Priority: P1)

**Goal**: no value, statistic or metadata text from the file reaches the page, spec, preview, output, errors, console or storage.

**Independent Test**: `npx vitest run parquet-privacy` and `npx playwright test parquet-privacy`.

- [ ] T028 [P] [US4] Spy test `tests/integration/parquet-privacy.test.ts`: a runner that records every row the engine returns while `markers.parquet` is inspected, loaded and profiled; fails if any marker (data, key-value text, created-by, statistics values) is returned; also asserts the queries issued never name `created_by`, `stats_*`, `min_value`, `max_value`, `parquet_kv_metadata` or `bloom_filter_*` (R2)
- [ ] T029 [P] [US4] Footer test in `tests/unit/parquet-writer.test.ts` and `tests/integration/parquet-readback.test.ts`: the fake file read with the engine's metadata functions and pyarrow shows `created_by` equal to this app's fixed string, no key-value metadata, no statistics, no bloom filter, no page index
- [ ] T030 [P] [US4] End-to-end leak test `tests/e2e/parquet-privacy.spec.ts`: run the whole flow on `markers.parquet` and search page text, spec JSON, preview, the downloaded file's bytes, console messages and local, session and IndexedDB storage for every marker; and the refusals: `not_parquet.parquet`, `truncated.parquet`, `empty.parquet` and an encrypted-footer file each give their fixed message with no content
- [ ] T031 [US4] Make the tests pass: the fixed error mapping in the worker (`src/workers/profile.worker.ts`), silent engine logging already in place for Excel, size and structure queries restricted per R2, and a guard that the `ParquetType` parser drops the engine's raw logical-type text

**Checkpoint**: the privacy claim is tested at the query, the file and the browser levels.

---

## Phase 6: User Story 3 - Nested and unusual columns (Priority: P2)

**Goal**: list, struct, map and other unsupported columns are marked, never read, and handled safely.

**Independent Test**: `npx vitest run parquet-schema parquet-load` and the nested columns in `parquet-flow`.

- [ ] T032 [P] [US3] Tests: nested and binary columns of the fixture are loaded as all-NULL (`tests/integration/parquet-load.test.ts`), appear as unsupported with the fixed reasons (`tests/component/parquet-ingest.test.tsx`), are left out of the fake file by default and written as an optional string column of nulls when kept, and the saved spec holds only their names and kinds (`tests/e2e/parquet-flow.spec.ts`)
- [ ] T033 [US3] Reason codes `nested_list`, `nested_struct`, `nested_map`, `nested_union`, `binary`, `uuid`, `interval` in `src/lib/profile/types.ts` with fixed texts in `src/features/review/summary.ts`; the profile worker sets them from the schema mapping
- [ ] T034 [US3] Writer and spec handling of a kept unsupported column (all-null optional string column under the same name), and validation that a Parquet spec with an unsupported column holds no `parquet_type` for it

**Checkpoint**: unsupported columns are safe and explained.

---

## Phase 7: Polish and Cross-Cutting

- [ ] T035 [P] Loading a Parquet spec without the file: `Session.loadSpecFile` accepts version 4, the output format follows `source.format`, CSV and Excel specs keep their formats; tests in `tests/component/spec-load.test.tsx`
- [ ] T036 [P] Offline release: add a Parquet session to `tests/e2e/offline-zip.spec.ts` (output equal to the hosted build's), and confirm `verify-release` needs no change
- [ ] T037 [P] Accessibility: extend `tests/e2e/a11y.spec.ts` to the structure card and the unsupported notes in light and dark themes
- [ ] T038 [P] Browser matrix: add `parquet-flow` and `parquet-privacy` to the Firefox and WebKit `testMatch` in `playwright.config.ts` and to `scripts/e2e-browsers.mjs`; run Chromium, Edge (`PW_EDGE=1`), Firefox and WebKit and fix what differs
- [ ] T039 [P] Docs: Help guide, `SpecContentsNotice.tsx` (a Parquet spec holds the file name, row-group count and type descriptions, no value, statistic or metadata text), and `README.md` (Parquet supported; nested columns not; compression used)
- [ ] T040 Large file: `python scripts/make-parquet-fixtures.py --large` writes a file of about 500 MB of expanded data (not file size) to `.fixtures/`; add `tests/e2e/parquet-scale.spec.ts` gated by `SCALE_PARQUET=1`; record profile time, export time and the stop limit in `research.md`
- [ ] T041 Record in `research.md` the bundle size and audit notes (no new dependency) and the measured results; run quickstart scenarios A to E and record results and the SC-008 person sign-off line in `quickstart.md`; dry-run `release.yml`
- [ ] T042 Run `/speckit-converge` and mark the slice complete

---

## Dependencies and order

- Phase 1, then Phase 2 (tests T004 to T008 before T009 to T011).
- US1 is the MVP and needs Phase 2. Within US1: tests T014, T015, T016 first, then T017 to T021.
- US2 needs US1's writer and loader. US4 needs US1 (the flow to attack); T028 and T029 can start as soon as T017 and T018 exist.
- US3 needs the schema mapping (T009) and the loader (T018); it can run beside US2.
- Polish last.

## Parallel examples

- Phase 2: T004 to T008 are different files; so are T012 and T013.
- US1: T014, T015, T016 together; T022 and T023 together after T021.
- US2 and US3 beside each other once US1 is done.

## Implementation strategy

MVP first: Phases 1 to 3 give a working Parquet round trip. Then US2 hardens the types, US4 proves the privacy claim, US3 handles the unsupported columns. Commit after each task group.
