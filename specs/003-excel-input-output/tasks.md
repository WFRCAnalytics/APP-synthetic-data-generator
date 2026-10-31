# Tasks: Excel Input and Output

**Input**: Design documents from `/specs/003-excel-input-output/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/spec-file-v3.md, quickstart.md

**Tests**: Included. The constitution (Principle VIII) requires tests for generators, validation and detection; the spec requires leak, request and smoke tests (FR-016, FR-017, FR-019). Write each test first and see it fail.

**Organization**: By user story. Stories 1, 2 and 4 are P1; story 3 is P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 workbook in and out, US2 Excel quirks, US3 limits and saved settings, US4 nothing real is kept
- Paths are from the repository root

---

## Phase 1: Setup

- [x] T001 Write `scripts/fetch-extensions.mjs`: ask the pinned DuckDB-WASM for `SELECT version()` (Node blocking build), download `excel` for `wasm_eh` and `wasm_mvp` from `extensions.duckdb.org/<version>/<platform>/` into `public/duckdb-ext/<version>/<platform>/`, check size and the WebAssembly magic bytes, write `public/duckdb-ext/VERSION.json` with files and sha-256 sums, skip the download when the files and sums are already right; run it from the `predev` and `prebuild` scripts in `package.json` (the folder is already in `.gitignore`)
- [x] T002 [P] Write `scripts/make-xlsx-fixtures.py` (xlsxwriter, openpyxl) that builds `tests/fixtures/xlsx/quirks.xlsx` (the spike workbook), `plain.xlsx` (one sheet, header on row 1), `dates1904.xlsx` (1904 date system), `wide.xlsx` (300 columns), `titles.xlsx` (title rows, totals row, comments, other sheets with marker strings), `formats.xlsx` (percent, currency, scientific, text, thousands, built-in format ids), `mixed.xlsx` (numbers and dates in one column), `damaged.xlsx` (truncated zip), `legacy.xls` (OLE header), `encrypted.xlsx` (OLE header with an EncryptedPackage stream), plus `--large` to write a 50 MB workbook to `.fixtures/`; commit the small outputs
- [x] T003 [P] Move the Excel spike (`spikes/excel.spec.ts`, the `excel()` method in `src/spikes/main.ts`) to a permanent CI smoke test `tests/e2e/excel-extension.spec.ts` (FR-017): load the extension from the site, read `plain.xlsx`, fail on any policy violation or outside request; wire it into `.github/workflows/deploy.yml` after the build (Playwright browsers installed in CI)

---

## Phase 2: Foundational (blocks every story)

- [x] T004 [P] Unit tests for spec version 3 (versions 1, 2 and 3 accepted, 4 refused with the newer-version message; xlsx source fields; CSV-only fields rejected on xlsx and the reverse; `cell_format` rules; the empty-text token in `na`) in `tests/unit/spec-validate-xlsx.test.ts`
- [x] T005 Add the xlsx source type, `cell_format`, `EMPTY_TEXT_TOKEN` and `SPEC_VERSION = 3` to `src/lib/spec/types.ts`, the valibot schemas and cross-field rules to `src/lib/spec/validate.ts`, and update `specs/001-csv-synthetic-slice/contracts/spec-file.schema.json` with a schema consistency test in the same test file
- [x] T006 [P] Unit tests for column letters, ranges and sheet name rules (A, Z, AA, XFD; `A3:I203`; names with spaces, accents and quotes; the 31-character and forbidden-character rules) in `tests/unit/xlsx-names.test.ts`
- [x] T007 [P] Implement `src/lib/xlsx/names.ts` (column letter to index and back, parse and format ranges, validate a sheet name)
- [x] T008 [P] Unit tests for serial numbers in both date systems (the 1900 leap-year quirk, 1904, fractions of a day, dates before 1900 refused with a clear result) in `tests/unit/xlsx-serial.test.ts`
- [x] T009 [P] Implement `src/lib/xlsx/serial.ts` (ISO date and datetime text to a serial and back, per date system)
- [x] T010 [P] Unit tests for number format codes (built-in ids 0 to 49, custom codes: `#,##0.00`, `0.0%`, `$#,##0`, `0.00E+00`, `mm/dd/yyyy`, `yyyy-mm-dd hh:mm`, `@`, quoted literals, locale prefixes like `[$-409]`; decimals, thousands, kind) in `tests/unit/xlsx-formats.test.ts`
- [x] T011 [P] Implement `src/lib/xlsx/formats.ts` (`classifyFormat(code)`, `decimalsOf`, `hasThousands`, `builtInFormat(id)`)
- [x] T012 [P] Unit tests for the zip reader and writer (read a real xlsx central directory; stored and deflated entries; write a streamed zip that Node's unzip and Python's `zipfile` read; sizes above 4 GB refused; data descriptors) in `tests/unit/xlsx-zip.test.ts`
- [x] T013 Implement `src/lib/xlsx/zip.ts` (read the central directory from the end of a `Blob`, read one entry through `DecompressionStream("deflate-raw")`, `createZipWriter` with data descriptors, CRC-32, deflate through `CompressionStream`)
- [x] T014 [P] Unit tests for the package metadata reader on every fixture: sheet names, hidden and very hidden, date system, expanded sizes, per-column format codes, suggested rows to skip, merged cells found and `not_checked`, the refusals (damaged, `.xls`, encrypted, not a zip, a zip that is not a workbook), and that no cell value is returned, in `tests/unit/xlsx-metadata.test.ts`
- [x] T015 Implement `src/lib/xlsx/metadata.ts` (`inspectWorkbook(blob)`, `inspectSheet(blob, sheet)`) using `zip.ts`, a small streaming XML scanner for `workbook.xml`, `styles.xml` and the head of the sheet, `names.ts` and `formats.ts`; classify refusals by the first bytes (R11)
- [x] T016 Add the xlsx settings to the shared types: a `SourceSettings` union (CSV settings or Excel settings) in `src/lib/profile/types.ts`, `cellFormat` on `ColumnProfile`, the reason codes `merged_cells`, `format_mismatch`, `sheet_hidden`, and their texts in `src/features/review/summary.ts`; update `src/lib/spec/build.ts` and `toProfiles.ts` to write and read the xlsx source and `cell_format` (round trip tests in `tests/unit/spec-roundtrip.test.ts`)
- [x] T017 Load the Excel extension in `src/lib/duckdb/engine.ts`: set `custom_extension_repository` to the site's own folder, keep `autoinstall` and `autoload` off, `LOAD excel` on demand, with a clear error if it cannot load; unit test the SQL it issues with a fake connection in `tests/unit/engine-extension.test.ts`

**Checkpoint**: spec version 3, the pure xlsx library and the extension loader exist; nothing is wired into the app yet.

---

## Phase 3: User Story 1 - A workbook in, a fake workbook out (Priority: P1) MVP

**Goal**: choose a workbook, pick a sheet, profile it like a CSV, generate, and download a fake workbook with the same sheet name, header position, column names, types and formats.

**Independent Test**: Quickstart scenario A.

### Tests for User Story 1

- [x] T018 [P] [US1] Node integration test of the conversion to text: build a synthetic typed table (DATE, TIMESTAMP, TIME, whole and fractional DOUBLE, BOOLEAN, VARCHAR with empty text, NULL) and check the text `buildConversionSql` produces (ISO dates, no ".0", `TRUE`/`FALSE`, `EMPTY_TEXT_TOKEN`, NULL stays NULL), and that the load issues no statement that returns rows (a recording runner), in `tests/integration/xlsx-load.test.ts`; the real `read_xlsx` path is covered by the browser tests T020 and T035 (Node cannot load the extension)
- [x] T019 [P] [US1] Unit tests for the streaming writer: the parts of the package, one style per format code, inline strings, number, date and text cells, rows above the header, column letters past Z, sheet name escaping, and that Python's `zipfile` and Node's own unzip can open it, in `tests/unit/xlsx-writer.test.ts`
- [x] T020 [P] [US1] Round trip in a browser: through the app profile `quirks.xlsx`, generate and download the fake workbook, load that download again through the app and compare sheet name, header row, column names, order, types and formats of the two profiles (and, when Python with openpyxl is available, read both files with the same openpyxl and pandas calls), in `tests/e2e/excel-flow.spec.ts`; a Node unit test checks the written package with the metadata reader in `tests/unit/xlsx-writer.test.ts`
- [x] T021 [P] [US1] Component tests for the workbook dialog (sheet dropdown with hidden marked, no cell value, rows to skip suggestion, header toggle, range field with errors, confirm) in `tests/component/workbook-dialog.test.tsx`

### Implementation for User Story 1

- [x] T022 [US1] Implement `src/workers/profile/xlsx.ts`: pure builders `buildReadSql` (the `read_xlsx` call with sheet, range or rows to skip, header) and `buildConversionSql` (R3: dates, whole numbers, booleans, empty-text to `EMPTY_TEXT_TOKEN`), and `loadSheet` that creates the all-text `src` table with them; `inspect` wraps `metadata.ts`
- [x] T023 [US1] Add `inspectWorkbook`, `workbookInfo`, `inspectSheet`, `sheetHints` and `loadSheet` to `src/workers/protocol.ts` and `src/workers/profile.worker.ts`, reusing `loaded`, `progress`, `columnProfile`, `profiled` and `error`; make `profileAll` and `collectBasic` treat `EMPTY_TEXT_TOKEN` as an NA token for workbooks
- [x] T024 [US1] Session support in `src/app/session.ts`: `openFile` recognizes a workbook by its content, shows the dialog state (`workbook` phase) and sends `loadSheet`; settings state becomes the `SourceSettings` union; `exportName` keeps the `.xlsx` extension; update `tests/helpers/fakeWorkers.ts` for the new messages
- [x] T025 [US1] Build `src/features/ingest/WorkbookDialog.tsx` (sheet dropdown, rows to skip with the suggestion, header toggle, optional range, hidden marking, merged-cells note) and let `IngestScreen.tsx` accept `.xlsx` and show the workbook source summary instead of the CSV settings
- [x] T026 [US1] Implement the writer in `src/lib/xlsx/writer.ts` (`createXlsxStream(plan)` yielding zip chunks, styles from `cell_format`, cells from text values per column kind, empty rows above the header, EMPTY_TEXT_TOKEN as an empty inline string)
- [x] T027 [US1] Output path: `src/lib/generate/table.ts` and `render.ts` choose CSV or xlsx from `spec.source.format` (the xlsx path yields the zip chunks), `src/workers/generate.worker.ts` streams them with progress, and `GenerateScreen` and the download use the `.xlsx` name and type
- [x] T028 [US1] Mark slice 1 deferred tasks T101, T104 and T106 superseded in `specs/001-csv-synthetic-slice/tasks.md`, T105 decided (SheetJS not needed, research R1)

**Checkpoint**: a typical workbook goes in and a fake workbook comes out. MVP.

---

## Phase 4: User Story 4 - Nothing real is kept (Priority: P1)

**Goal**: the guarantees of FR-003, FR-016, FR-018, FR-019 and SC-003 and SC-004 are enforced by tests, for workbooks.

**Independent Test**: Quickstart scenario D.

### Tests for User Story 4

- [x] T029 [P] [US4] Spy tests: (a) in Node, record every statement and row of the workbook load and of profiling a table made from a synthetic typed sheet and fail if any marker or cell value comes back; (b) in a browser, load `titles.xlsx` through the app and fail if any marker from other sheets, the title row or comments appears in the page, spec, preview, download or an error, in `tests/integration/xlsx-privacy.test.ts` and `tests/e2e/excel-flow.spec.ts`
- [x] T030 [P] [US4] Metadata test: the reader returns only names, flags, sizes and format codes (serialize its output and search it for every cell value and marker in `titles.xlsx`), added to `tests/unit/xlsx-metadata.test.ts`
- [x] T031 [P] [US4] Browser leak test: extend `tests/e2e/privacy.spec.ts` with `titles.xlsx` so no marker or cell value appears in the page, spec, preview, download, errors or browser storage, and no request leaves the site while the extension loads and the workbook is read
- [x] T032 [P] [US4] Refusal tests: a damaged workbook, `legacy.xls`, `encrypted.xlsx`, a text file renamed `.xlsx` and a zip that is not a workbook each give their own clear message with no cell content, in `tests/unit/xlsx-metadata.test.ts` and `tests/e2e/excel-flow.spec.ts`

### Implementation for User Story 4

- [x] T033 [US4] Make the worker and `sanitizeError` map every xlsx failure to a fixed message code (`xlsx_damaged`, `xlsx_legacy`, `xlsx_encrypted`, `xlsx_not_workbook`, `xlsx_sheet_missing`, `xlsx_range_invalid`, `xlsx_too_large`) in `src/lib/errors.ts`, and show them on the ingest screen
- [x] T034 [US4] Ensure only the chosen sheet is requested from the extension and that no other package part is opened by our code (a test with a spy on `zip.ts` entry reads in `tests/unit/xlsx-metadata.test.ts`)

**Checkpoint**: every guarantee has a failing-if-broken test.

---

## Phase 5: User Story 2 - The Excel quirks (Priority: P1)

**Goal**: dates, text numbers, leading zeros, number formats, blanks versus empty text, formulas and merged cells survive.

**Independent Test**: Quickstart scenario B.

### Tests for User Story 2

- [x] T035 [P] [US2] Browser tests per quirk through the app against `quirks.xlsx`, `formats.xlsx` and `dates1904.xlsx`: zip text keeps zeros, amounts keep `#,##0.00` and 2 decimals, percent and currency formats, dates round trip in both date systems, blank and empty-text counts equal, formulas read as values with no formula text in the spec or file, in `tests/e2e/excel-quirks.spec.ts`; the writer's cell types for each quirk are unit tested in `tests/unit/xlsx-writer.test.ts`
- [ ] T036 [P] [US2] Unit tests for format detection from a column: the first cells' style decides, mixed formats raise `format_mismatch`, a number column displayed as text stays text, in `tests/unit/xlsx-metadata.test.ts`
- [ ] T037 [P] [US2] Component tests for the quirk notes (merged cells found, mixed formats, hidden sheet chosen) in `tests/component/workbook-dialog.test.tsx` and `tests/component/review-xlsx.test.tsx`

### Implementation for User Story 2

- [ ] T038 [US2] Carry formats through profiling: `cellFormat` per column from `SheetHints.formats`; `decimals` and `thousands` come from the format code, not the value digits; a date column's pattern is the ISO pattern with `cellFormat` as the display code; text-kind formats mark columns written as text cells (`src/workers/profile/xlsx.ts`, `profiler.ts`)
- [ ] T039 [US2] Keep blanks and empty text apart: spec `na` tokens with `EMPTY_TEXT_TOKEN`, the placer and check table count them separately (`src/lib/generate/column.ts`, `checks.ts`), and the writer writes the two differently
- [ ] T040 [US2] Merged cells and hidden sheets: hint, reason codes and notes on the dialog and the cards; a column whose cells carry different formats gets `format_mismatch` and the first format is used
- [ ] T041 [US2] Review editor for the cell format of a column (select from the formats of its kind, plus a custom code with validation) in `src/features/review/CellFormatEditor.tsx`, wired into `ColumnEditors.tsx`

**Checkpoint**: the test workbook's columns all read back with the same type and format.

---

## Phase 6: User Story 3 - Limits and saved settings (Priority: P2)

**Goal**: a size warning before loading, a stop beyond memory, and the Excel source in the spec.

**Independent Test**: Quickstart scenario C.

### Tests for User Story 3

- [ ] T042 [P] [US3] Unit tests for the size estimate and thresholds (warning at 100 MB expanded, stop at the recorded limit, text with the estimated memory) in `tests/unit/size-warning.test.ts`
- [ ] T043 [P] [US3] Component tests: the warning appears in the dialog before profiling and a too large sheet cannot be loaded; loading an xlsx spec without a workbook shows the spec-only banner and generates an `.xlsx`, in `tests/component/workbook-dialog.test.tsx` and `tests/component/spec-load.test.tsx`
- [ ] T044 [P] [US3] Spec tests: an xlsx spec for a profiled sheet holds the sheet, range, rows skipped, header, date system and format codes and no cell value, stays under 1 MB, and round trips (unit, from a synthetic profile) in `tests/unit/spec-roundtrip.test.ts`, and the saved spec of `quirks.xlsx` in a browser in `tests/e2e/excel-flow.spec.ts`

### Implementation for User Story 3

- [ ] T045 [US3] Extend `src/features/ingest/sizeWarnings.ts` and `SizeWarning.tsx` for workbooks (expanded size from the zip directory, memory estimate) and add the stop in `src/workers/profile/xlsx.ts`
- [ ] T046 [US3] Loading an xlsx spec without a workbook: `Session.loadSpecFile` accepts version 3, the output format follows `source.format`, and a CSV spec still produces a CSV (FR-020) with tests in `tests/component/spec-load.test.tsx`

**Checkpoint**: large workbooks are warned about or stopped; saved settings read the same sheet again.

---

## Phase 7: Polish & Cross-Cutting

- [ ] T047 [P] Extend `tests/e2e/a11y.spec.ts` to the workbook dialog and the cell format editor in light and dark themes, and fix any violation
- [ ] T048 [P] Browser tests of the whole flow in `tests/e2e/excel-flow.spec.ts` (workbook in, fake workbook out, read back with the extension; spec save, reload, load) in Chromium, then `npm run test:e2e:browsers` and Edge
- [ ] T049 [P] Update `src/app/HelpGuideModal.tsx`, `SpecContentsNotice.tsx` and `README.md` (Excel is supported; what is kept and what is not; the one-sheet output; .xls refused)
- [ ] T050 Measure the large workbook: `python scripts/make-xlsx-fixtures.py --large`, `SCALE_XLSX=1 npx playwright test excel-scale.spec` (new, gated like `scale.spec`), record profile time, export time, peak memory and the stop limit in `research.md` (R8)
- [ ] T051 Dependency and bundle audit: the extension is a file, not a package; record the sizes of `public/duckdb-ext/` and the main and worker bundles in `research.md`, and the deploy workflow run that fetches the extension
- [ ] T052 Record the SheetJS decision (not needed, with the spike evidence) in `research.md` and update slice 1's research audit
- [ ] T053 Run quickstart scenarios A to E in Chrome, Edge, Firefox and WebKit, and record the results and the person-timing sign-off lines (SC-008 here, slice 1 SC-007 and SC-008) in this feature's `quickstart.md`
- [ ] T054 Run `/speckit-converge` and mark the slice complete

---

## Dependencies and Order

- Phase 1 then Phase 2, which blocks everything.
- US1 (Phase 3) is the MVP and needs Phase 2. US4 (Phase 4) tests need US1's load path; write them beside US1 and run them before anything is pushed to the live site. US2 and US3 build on US1 and are independent of each other.
- Within a story: tests first, then pure code, then worker, then session and UI.
- Polish after the stories.

## Parallel Examples

- Phase 2: T004, T006, T008, T010, T012 and T014 are different files and can be written together; T007, T009, T011 follow their tests.
- US1 tests T018 to T021 can be written in parallel.
- US4 tests T029 to T032 can be written in parallel.

## Implementation Strategy

1. MVP: Phases 1, 2 and 3 (a workbook goes in, a fake workbook comes out).
2. US4 immediately after: the guarantees must exist before this reaches the live site.
3. US2 then US3, committing after each phase.
4. Polish and release, deploying to GitHub Pages from main.

## Task Counts

| Phase | Tasks |
|---|---|
| Setup | 3 |
| Foundational | 14 |
| US1 | 11 |
| US4 | 6 |
| US2 | 7 |
| US3 | 5 |
| Polish | 8 |
| Total | 54 |
