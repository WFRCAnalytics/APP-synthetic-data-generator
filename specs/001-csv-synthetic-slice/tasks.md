---

description: "Task list for the CSV Synthetic Data Slice (feature 001)"
---

# Tasks: CSV Synthetic Data Slice

**Input**: Design documents from `/specs/001-csv-synthetic-slice/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. Constitution Principle VIII requires tests with every change to the correctness
core, and the success criteria (exact summaries, determinism, zero cross-origin requests) need them.

**Organization**: Grouped by user story (US1 to US6 from spec.md) so each story can be built and
verified on its own. The "Deferred Backlog" at the end is the single record of everything the spec
puts out of scope; those tasks stay unchecked until their own feature starts (Principle X).

> **Numbering note**: T119 to T122 were added after `/speckit-analyze` and the fixture review. They keep their IDs so existing
> references stay valid, and sit in the phase where they are executed.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 to US6, matching spec.md. Setup, Foundational, Polish and Deferred tasks carry none
- Paths are relative to the repository root

## Path Conventions

Single Vite project: `src/`, `tests/`, `scripts/` at the repository root (see plan.md, Project
Structure). Pure logic lives in `src/lib/` (no DOM); only `src/workers/profile.worker.ts` ever reads
real data.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and tooling, mirroring the Scoresheet reference app

- [X] T001 Create `package.json` (React 18.3, Vite 5.4, TypeScript 5.x, Vitest 2, ESLint 8, Prettier 3, `@duckdb/duckdb-wasm` pinned to an exact version, `@tanstack/react-virtual`, `valibot`, `@playwright/test`, React Testing Library) with scripts `dev`, `build`, `preview`, `lint`, `typecheck`, `test`, `test:e2e`, `fixtures`, `verify:roundtrip`, `format`
- [X] T002 [P] Create `tsconfig.json` and `vite.config.ts` (base `/APP-synthetic-data-generator/`, ES-module workers, `.wasm` asset handling, Vitest config with jsdom and `tests/setup.ts`)
- [X] T003 [P] Copy and adapt `.eslintrc.cjs`, `.eslintignore`, `.prettierrc.json`, `.prettierignore` from `WFRCAnalytics/APP-Project-Scoresheet`
- [X] T004 [P] Create `scripts/copy-duckdb.mjs` that copies the DuckDB-WASM binaries and workers from `node_modules` into `public/duckdb/` with no network access, and wire it into `predev` and `prebuild` in `package.json`
- [X] T005 [P] Create `tests/setup.ts` and add `.fixtures/` to `.gitignore`
- [X] T006 [P] Create `scripts/make-fixtures.mjs` (fixed seed, `@faker-js/faker` as a dev dependency for personal-data columns) that writes the "type zoo" per `contracts/fixture-matrix.md`: `tests/fixtures/zoo/zoo_small.csv` (2,000 rows, committed), `tests/fixtures/zoo/expected.json` (expected type, status and reason codes per column), `tests/fixtures/zoo/ids_50k.csv`, and the file-level variants (UTF-8 BOM, UTF-16 LE and BE, Windows-1252, delimiters, no header, line endings, quote styles including per-column quoting, ragged, empty and header-only files)
- [X] T007 Create `index.html` with the Content-Security-Policy meta tag from `contracts/worker-protocol.md` section 4 and the app mount point. Apply the strict policy in build and preview only and use a dev-safe variant through `transformIndexHtml` (Vite's React plugin injects an inline script in dev; see research.md R9). Browser tests run against `vite preview`
- [X] T008 [P] Create `README.md` with the privacy statement, dev commands, and a link to `specs/001-csv-synthetic-slice/quickstart.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Brand shell, the VERIFY prototypes from research.md, and the pure core that every story uses

**CRITICAL**: No user story work starts until this phase is complete.

### Brand shell

- [X] T009 [P] Copy `src/theme/tokens.css`, `fonts.ts` and `useTheme.ts` from the Scoresheet reference app into `src/theme/`
- [X] T010 [P] Copy and adapt `app.css` into `src/styles/app.css`, and the `Modal`, `Badge`, `EmptyState`, `SelectField` and `ConfirmDialog` components into `src/components/`
- [X] T011 [P] Copy the WFRC logo into `src/assets/logo/` and adapt `AppHeader.tsx` into `src/app/AppHeader.tsx` (logo and header match the reference)
- [X] T012 Create `src/main.tsx`, `src/App.tsx`, the app state reducer in `src/app/state.ts` (steps `ingest`, `review`, `generate`; transitions from data-model.md; going back keeps overrides for columns whose name and type are unchanged) with a reducer test in `tests/unit/state.test.ts`, and `src/app/Stepper.tsx` that allows going back
- [X] T013 [P] Create `src/app/LocalNotice.tsx` (persistent "processed locally; reload clears data" notice) and mount it in `src/App.tsx`

### Prototypes (VERIFY items from research.md; each ends by recording the result in research.md)

- [X] T014 Extend `scripts/make-fixtures.mjs` with `--100k` and `--large` that write `.fixtures/zoo_100k.csv` and the ~500 MB, ~120-column `.fixtures/zoo_500mb.csv` (zoo columns repeated with suffixes; deterministic, never committed)
- [X] T121 [P] Create `scripts/fetch-corpus.mjs` that downloads, at a pinned tag, the selected CSV edge-case files from `duckdb/duckdb` `data/csv` (encodings, dates, decimal separators, leading zeros, quoted newlines, null padding, bad dates) and `csv-spectrum`, plus the smoke datasets (NHTS 2017 `trippub.csv`, a 1M-row Chicago Crimes slice), into `.fixtures/corpus/` (gitignored, never committed); tests that need them skip with a clear message when the folder is absent
- [X] T015 Spike R9: instantiate DuckDB-WASM under the page CSP from T007 in `tests/e2e/spikes/csp.spec.ts`; record the outcome and any narrowest-needed CSP change in `research.md`
- [X] T016 Spike R1: in `tests/e2e/spikes/memory.spec.ts`, register the 500 MB fixture with `registerFileHandle`, load it as an all-text table, and record memory and time in `research.md`; if it does not fit, T091 (profile in column batches from the file handle) becomes required
- [X] T017 [P] Spike R2: in `tests/e2e/spikes/encoding.spec.ts`, check `read_csv` with `utf-16` and `latin-1` on the encoding fixtures; record the result and, if it fails, T120 (the `TextDecoderStream` fallback) becomes required
- [X] T018 [P] Spike R14: in `tests/e2e/spikes/download.spec.ts`, assemble a 500 MB Blob from chunks and download it in Chrome and Edge; record the result and, if it fails, T092 (streamed save) becomes required

### Pure core (unit tests included)

- [X] T019 [P] Implement sfc32 and per-column sub-seed derivation in `src/lib/rng/sfc32.ts` and `src/lib/rng/subseed.ts`, with tests in `tests/unit/rng.test.ts`
- [X] T020 [P] Implement the keyed Feistel bijection with cycle-walking (BigInt only when the domain exceeds 2^53) in `src/lib/rng/permute.ts`, with exhaustive small-domain bijection tests in `tests/unit/permute.test.ts`
- [X] T021 [P] Implement counter-based per-row draws in `src/lib/rng/counter.ts`, with tests in `tests/unit/counter.test.ts`
- [X] T022 [P] Define spec types and valibot validators in `src/lib/spec/types.ts` and `src/lib/spec/validate.ts` matching `contracts/spec-file.schema.json` (errors named by column; includes the per-column `quoted` flag), with tests in `tests/unit/spec-validate.test.ts`
- [X] T023 [P] Implement the shared date directive table, TypeScript formatter and DuckDB `strptime` translation in `src/lib/datefmt/directives.ts`, with tests in `tests/unit/datefmt.test.ts`
- [X] T024 [P] Implement BOM and encoding detection (UTF-8, UTF-16 LE/BE, Windows-1252) in `src/lib/encoding/detect.ts`, with tests in `tests/unit/encoding-detect.test.ts`
- [X] T025 [P] Implement UTF-8, UTF-16 and Windows-1252 encoders in `src/lib/csv/encoders.ts`, with tests in `tests/unit/encoders.test.ts`
- [X] T026 [P] Implement the CSV writer (delimiter, quote style including `per_column` driven by each column's `quoted` flag, line endings, BOM, trailing newline) in `src/lib/csv/writer.ts`, with tests in `tests/unit/csv-writer.test.ts`
- [X] T027 Define the typed worker messages from `contracts/worker-protocol.md` in `src/workers/protocol.ts`, and the error type that forbids cell values in messages in `src/lib/errors.ts`, with a test in `tests/unit/errors.test.ts`

**Checkpoint**: Shell renders, prototype results are recorded, pure core is tested. Stories can begin.

---

## Phase 3: User Story 1 - Turn a private CSV into a fake CSV (Priority: P1) MVP

**Goal**: CSV in, defaults accepted, fake CSV out for categorical, numeric, date and boolean columns,
with unsupported columns safely excluded.

**Independent Test**: Quickstart scenarios A and G on `tests/fixtures/zoo/zoo_small.csv`.

### Tests for User Story 1

- [X] T028 [P] [US1] Integration test for profiling SQL on small fixtures (counts, NA, min, max, mean, sd, quantiles) using DuckDB's Node bindings in `tests/integration/profile.test.ts`
- [X] T029 [P] [US1] Unit tests for type detection rules in SPEC.md order, coded integers defaulting to categorical, the "unsupported" rule (emails, free text, many-valued short codes, latitude and longitude), and survey ID detection taking precedence over categorical (an ID column with 50 or fewer distinct values is never typed categorical), asserted column by column against `tests/fixtures/zoo/expected.json` so a failure names the column and rule, in `tests/unit/classify.test.ts`
- [X] T030 [P] [US1] Unit tests that generated columns hit exact label counts, NA counts, sentinel counts, min and max in `tests/unit/generate-columns.test.ts`
- [X] T031 [P] [US1] Integration test for the CSV round trip (fake file parses with the same code as the real one, SC-004) in `tests/integration/roundtrip.test.ts`
- [X] T032 [P] [US1] Component test for the ingest, review and generate flow with mocked workers in `tests/component/flow.test.tsx`
- [X] T122 [P] [US1] Corpus robustness test: every file in `.fixtures/corpus/` either profiles without a crash or fails with a clear message that holds no cell value, and files that parse round-trip through generate and export, in `tests/integration/corpus.test.ts`

### Implementation for User Story 1

- [X] T033 [P] [US1] Implement beta-by-gamma, uniform and quantile-interpolation samplers in `src/lib/sampling/` with moment tests in `tests/unit/sampling.test.ts`
- [X] T034 [P] [US1] Implement NA token and sentinel candidate detection in `src/lib/classify/na.ts` and `src/lib/classify/sentinels.ts`, with tests in `tests/unit/na-sentinels.test.ts`
- [X] T035 [US1] Implement the type classifier, the "unsupported" rule, and survey ID detection (name ends in `id` or `_num`; unique or grouped integers and codes; checked before categorical, per SPEC.md order) in `src/lib/classify/classify.ts` (uses T034; never reads values, only summaries). Until T065 lands, `survey_id` columns are marked `needs_attention` and excluded by default so no ID value can reach the spec as a category label
- [X] T036 [US1] Implement `profile.worker.ts` messages `open`, `settingsDetected`, `load`, `loaded` (sniff the file, register the handle, create the all-text table, and infer each column's `quoted` flag and the file's `quoteStyle` by sampling the raw bytes of the first 10,000 rows) in `src/workers/profile.worker.ts`; a file that cannot be parsed returns an `error` that names the problem and a row number, never a cell value (FR-003), with a test in `tests/unit/errors.test.ts`
- [X] T120 [US1] Required (T017 spike: UTF-16 BE and Windows-1252 with bytes 0x80-0x9F fail natively): decode UTF-16 BE and every Windows-1252 file with `TextDecoderStream` in the profile worker and register the UTF-8 result in memory with `registerFileBuffer`, in `src/workers/profile/transcode.ts`; UTF-8 and UTF-16 LE keep the native `read_csv` path. See research.md, R2 follow-up
- [X] T037 [US1] Implement batched column statistics SQL in `src/workers/profile/stats.ts` and the `profile` and `columnProfile` messages, reporting progress per batch
- [X] T038 [US1] Build the ingest screen in `src/features/ingest/IngestScreen.tsx` (file picker, detected delimiter, encoding, quote and header with editing, row count, column count, names only; shows the parse error message from T036)
- [X] T039 [US1] Build the basic review screen in `src/features/review/ReviewScreen.tsx` and `ColumnCard.tsx` with a hand-drawn SVG chart in `src/features/review/Sparkline.tsx`; show unsupported and excluded labels
- [X] T040 [P] [US1] Implement the per-column generator (rank placement of NA and sentinels, categorical by cumulative counts, numeric by mode with exact min and max) in `src/lib/generate/column.ts`, `categorical.ts` and `numeric.ts`
- [X] T041 [P] [US1] Implement date, datetime and time generation (number to string using the original pattern and granularity) in `src/lib/generate/datetime.ts`
- [X] T042 [US1] Implement the generate worker (chunked rows, preview of 50 rows, CSV encoding with the original settings, excluded columns dropped or kept as all-NA) in `src/workers/generate.worker.ts`
- [X] T043 [US1] Implement the check table computation (target versus achieved for counts, NA, sentinels, min, max, mean, sd) in `src/lib/generate/checks.ts`
- [X] T044 [US1] Build the generate screen in `src/features/generate/GenerateScreen.tsx` (seed field that rejects a blank or out-of-range value, 0 to 4,294,967,295, with a message and a component test in `tests/component/seed-field.test.tsx`; Generate, preview table, check table) and `ExportButton.tsx` (Blob download, `_fake` suffix with a keep-original-name toggle)
- [X] T045 [P] [US1] Create `scripts/verify-roundtrip.mjs` that parses real and fake files with the same code and compares names, order and types (SC-004)
- [X] T046 [US1] Wire the three screens through the app state in `src/App.tsx` and verify quickstart scenarios A and G

**Checkpoint**: A user can turn a simple CSV into a fake CSV end to end. This is the MVP.

---

## Phase 4: User Story 2 - Review and override every column decision (Priority: P1)

**Goal**: The analyst can correct every detection before generating.

**Independent Test**: Quickstart scenario B on `tests/fixtures/zoo/zoo_small.csv`.

### Tests for User Story 2

- [X] T047 [P] [US2] Component tests for type override, sentinel editor, NA token editor, numeric mode and decimals, exclude options, and protections off by default in `tests/component/review-overrides.test.tsx`
- [X] T048 [P] [US2] Component tests for search, the "needs attention" filter, the type filter and the banner in `tests/component/review-filters.test.tsx`
- [X] T049 [P] [US2] Unit tests for rare-category merging, label codes and column renaming in `tests/unit/protections.test.ts`
- [X] T050 [P] [US2] Unit and integration tests for the date pattern box (live parsed count, fall back to unsupported on failure) in `tests/unit/date-pattern.test.ts`

### Implementation for User Story 2

- [X] T051 [US2] Add type override and categorical threshold controls to `ColumnCard.tsx` and `src/features/review/ColumnEditors.tsx`, calling `reprofile` on the profile worker
- [X] T052 [P] [US2] Build the sentinel and NA token editors in `src/features/review/SentinelEditor.tsx` and `NaTokenEditor.tsx` (confirmed sentinels leave min, max, mean and sd)
- [X] T053 [P] [US2] Build numeric controls (uniform, match mean and sd, match shape, decimals or integer, optional rescale) in `src/features/review/NumericControls.tsx`, and implement the two-pass rescale in `src/lib/sampling/rescale.ts`, leaving the two reserved min and max rows out of the fit and re-pinning them to the exact values afterward, with a unit test in `tests/unit/rescale.test.ts` that exact min and max survive rescale and rounding (FR-024, SC-002)
- [X] T054 [P] [US2] Implement exclusion (drop by default, keep as all-NA) in `src/features/review/ExcludeControl.tsx`
- [X] T055 [P] [US2] Implement protections (merge under k into "Other", neutral label codes, rename columns), all off by default, in `src/lib/protections.ts` and `src/features/review/ProtectionsPanel.tsx`
- [X] T056 [US2] Implement the date pattern box in `src/features/review/DatePatternBox.tsx` with the `datePattern` worker message and `datePatternResult` reply
- [X] T057 [US2] Build the column list search, "needs attention" and type filters, and the uncertain-columns banner in `src/features/review/ColumnFilters.tsx` and `AttentionBanner.tsx`
- [X] T058 [US2] Handle `beta_fit_failed` (fall back to uniform and flag) in `src/lib/sampling/beta.ts` and show it on the card
- [X] T119 [US2] Add the persistent Review notice that the saved spec will contain real category labels, exact min and max and sentinel codes, and nothing else derived from the data (FR-038), in `src/features/review/SpecContentsNotice.tsx`, with a component test in `tests/component/spec-contents-notice.test.tsx`

**Checkpoint**: Every automatic decision can be reviewed and changed.

---

## Phase 5: User Story 3 - Describe survey IDs by pattern, never by list (Priority: P1)

**Goal**: IDs are generated from a mask and repeat structure; no ID value is ever stored.

**Independent Test**: Quickstart scenario C on `tests/fixtures/ids_50k.csv`.

### Tests for User Story 3

- [X] T059 [P] [US3] Unit tests for mask inference results, capacity (including numeric `[min, max]` and zero padding) and generation that fits the mask and repeat structure in `tests/unit/mask.test.ts`
- [ ] T060 [P] [US3] Integration test that ID inference SQL returns only patterns and aggregates (no ID value) in `tests/integration/id-inference.test.ts`
- [ ] T061 [P] [US3] Privacy test that a saved spec for `tests/fixtures/zoo/ids_50k.csv` contains none of the fixture IDs and stays under 1 MB in `tests/integration/spec-privacy.test.ts`
- [ ] T062 [P] [US3] Component tests for the mask editor, live sample and the "allows X, needs Y" block in `tests/component/id-mask-editor.test.tsx`

### Implementation for User Story 3

- [ ] T063 [US3] Implement the ID pattern SQL (class pattern, per-position literals, numeric min, max and padding, repeat structure) in `src/workers/profile/ids.ts`
- [X] T064 [P] [US3] Implement the mask model, capacity and mixed-radix mapping in `src/lib/mask/mask.ts`
- [X] T065 [US3] Implement ID generation (group assignment from the repeat structure, keyed bijection to mask values) in `src/lib/generate/survey-id.ts`
- [ ] T066 [US3] Build the ID mask token editor with a live sample in `src/features/review/IdMaskEditor.tsx`
- [ ] T067 [US3] Implement the FR-016a block (capacity versus needed, `needs_attention`, disabled Generate) in `src/features/review/idCapacity.ts` and the generate screen
- [ ] T068 [US3] Remove the temporary exclusion of `survey_id` columns added in T035 (depends on T065 and T067) so detected IDs generate through the mask, and extend `tests/unit/classify.test.ts` for mixed-mask and unique-per-row ID columns

**Checkpoint**: ID columns generate to the pattern, and the privacy test proves nothing leaks.

---

## Phase 6: User Story 5 - Trust that nothing leaves the device (Priority: P1)

**Goal**: A visible, enforced guarantee that data stays local.

**Independent Test**: Quickstart scenario E.

### Tests for User Story 5

- [X] T069 [P] [US5] Unit tests for the counter store (same-origin, cross-origin, blocked) in `tests/unit/net-counter.test.ts`
- [X] T070 [P] [US5] Playwright test that a full flow shows 0 cross-origin and 0 blocked, and that only same-origin requests occur, in `tests/e2e/privacy.spec.ts`
- [X] T071 [P] [US5] Playwright test that reload clears all data and returns to the start, and that no browser storage holds data, in `tests/e2e/reload.spec.ts`
- [X] T072 [P] [US5] Playwright test that no fixture cell value appears in the DOM before the fake preview, and that error messages contain none, in `tests/e2e/no-real-rows.spec.ts`

### Implementation for User Story 5

- [X] T073 [US5] Implement `src/workers/netpatch.ts` (patch `fetch` and `XMLHttpRequest`, post `net` messages) and wrap both worker constructors with it (the constructors are created in T036 and T042, so build T073 to T075 before showing the MVP to the maintainer with real data)
- [X] T074 [US5] Implement the counter store in `src/app/netCounter.ts` (main-thread `PerformanceObserver`, wrapped `fetch`, worker reports, `securitypolicyviolation`)
- [X] T075 [US5] Build `src/app/NetworkCounter.tsx` showing same-origin, cross-origin and blocked counts, visible on every screen
- [X] T076 [US5] Terminate workers and drop all state on "start over"; confirm nothing is written to browser storage (audit in `src/app/state.ts`)

**Checkpoint**: The privacy claim is visible and checked by tests.

---

## Phase 7: User Story 4 - Save a spec, reload it, reproduce output (Priority: P2)

**Goal**: Spec file round trip and deterministic output.

**Independent Test**: Quickstart scenario D.

### Tests for User Story 4

- [ ] T077 [P] [US4] Unit test that the same spec and seed give byte-identical output across different chunk sizes, and that changing one column changes no other, in `tests/unit/determinism.test.ts`
- [ ] T078 [P] [US4] Component tests for loading a good spec (jumps to Review) and a bad spec (errors by column) in `tests/component/spec-load.test.tsx`
- [ ] T079 [P] [US4] Unit test for spec save then load restoring every setting in `tests/unit/spec-roundtrip.test.ts`

### Implementation for User Story 4

- [ ] T080 [US4] Build the spec serializer from app state in `src/features/spec/saveSpec.ts` and the Save and Export spec buttons (review and generate screens)
- [ ] T081 [US4] Build the spec loader (file picker, validation, error list by column, jump to Review) in `src/features/spec/loadSpec.ts` and `SpecErrors.tsx`, with "Load existing spec" on the ingest screen; loading a spec replaces any open file and goes straight to Review, so a spec and a real file are never combined (FR-004)
- [ ] T082 [US4] Make Generate work from a loaded spec with no source file (generate worker only) and show the spec-only banner in `src/features/generate/GenerateScreen.tsx`
- [X] T083 [US4] Add the `spec_version` check and clear messages for newer or older versions in `src/lib/spec/validate.ts`

**Checkpoint**: Specs round trip and reproduce exactly.

---

## Phase 8: User Story 6 - Work with large, wide tables (Priority: P2)

**Goal**: A ~500 MB, ~120-column table works within the time targets.

**Independent Test**: Quickstart scenario F.

### Tests for User Story 6

- [ ] T084 [P] [US6] Component test that the column list virtualizes 120+ cards and search returns matching columns within a few hundred milliseconds in `tests/component/virtual-list.test.tsx` (the 15-second human timing in SC-008 is a manual check in T096)
- [ ] T085 [P] [US6] Playwright test on the 500 MB fixture: profile under 5 minutes and generate plus export under 5 minutes with progress and a responsive page, in `tests/e2e/scale.spec.ts`. Run manually on the reference laptop (4 or more cores, 16 GB, current Chrome or Edge); CI runs only the small-fixture variant
- [ ] T086 [P] [US6] Playwright test that Firefox and WebKit download a single file, in `tests/e2e/download-fallback.spec.ts`

### Implementation for User Story 6

- [ ] T087 [US6] Virtualize the column list with `@tanstack/react-virtual` in `src/features/review/ColumnList.tsx` (keeps filters and search working)
- [ ] T088 [US6] Add profiling progress and cancel (batch progress, `cancel` message) in `src/features/ingest/ProfileProgress.tsx` and the worker
- [ ] T089 [US6] Add generation and export progress with cancel in `src/features/generate/GenerateProgress.tsx` and the generate worker
- [ ] T090 [US6] Add the size warning (large files, and xlsx later) in `src/features/ingest/SizeWarning.tsx`
- [X] T091 [US6] If the T016 spike failed, implement profiling in column batches straight from the file handle in `src/workers/profile/batchFromHandle.ts`; otherwise mark this task done with "not needed" and the spike result
  - Not needed: the T016 spike passed (500 MB loads in 4.1 s; see research.md, Spike results).
- [X] T092 [US6] If the T018 spike failed, implement streamed save via `showSaveFilePicker` where available in `src/features/generate/streamSave.ts`; otherwise mark done with "not needed"
  - Not needed for Chromium: the T018 spike passed. Firefox and WebKit are still checked by T086.

**Checkpoint**: Large, wide tables meet the timing targets.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T093 [P] Accessibility pass: keyboard operation of every control, visible focus ring, contrast check with a unit test in `tests/unit/contrast.test.ts` (Principle VII, FR-037)
- [ ] T094 [P] Add a help guide modal (what is stored, what is not, known limits from SPEC.md) in `src/app/HelpGuideModal.tsx`
- [ ] T095 [P] Review `package.json` for any dependency that can make network requests or send telemetry and record the audit in `research.md`
- [ ] T096 Run all quickstart scenarios A to G in Chrome and Edge, and A and G in Firefox and Safari, plus the manual checks for SC-007 (typical table to fake CSV in under 10 minutes) and SC-008 (find any column in a 120-column table in under 15 seconds), and record the results in `specs/001-csv-synthetic-slice/quickstart.md`
- [ ] T097 Run `/speckit-converge` to re-sync this file with the code, then mark the slice complete

---

## Deferred Backlog (not started; each belongs to a later feature)

These are the out-of-scope items from spec.md. They stay unchecked on purpose so nothing is forgotten.
Slice 1 is complete when Phases 1 to 9 are done, regardless of this section.

### Infrastructure feature (Principle III and IX, required before the v1 release)

- [ ] T098 GitHub Actions workflow that runs lint, typecheck and tests, builds, and deploys to GitHub Pages without committing build output, in `.github/workflows/deploy.yml`
- [ ] T099 Release workflow that attaches an offline zip (app, DuckDB-WASM binaries and extension files) in `.github/workflows/release.yml`
- [ ] T100 Extension fetch script that derives the matching DuckDB engine version and downloads extension files into `public/duckdb/`, in `scripts/fetch-extensions.mjs`
- [ ] T101 CI smoke test that the bundled Excel extension loads a tiny xlsx file in `tests/e2e/excel-extension.spec.ts`
- [ ] T102 Folder output through the File System Access API in Chrome and Edge, with single-file download fallback, in `src/features/generate/folderOutput.ts`
- [ ] T103 Chore: move the whole stack to current majors together (React, Vite, Vitest, TypeScript, ESLint) and update the constitution's technology section

### Excel feature

- [ ] T104 Excel input through DuckDB's Excel reader, with the load dialog (worksheet names as a dropdown only; range, rows to skip and header-row toggle; no cell data shown), in `src/features/ingest/ExcelDialog.tsx`
- [ ] T105 SheetJS fallback, used only if T104 proves insufficient, and the decision recorded in `research.md`
- [ ] T106 Excel export preserving sheet name, header row offset and cell types in `src/lib/excel/writer.ts`

### Column types and formats

- [ ] T107 Parquet input and output preserving dtypes, nullable integers and time zones
- [ ] T108 Personal identifier columns through `@faker-js/faker` (en_US only for v1), with repeat structure
- [ ] T109 Free text columns (length-distribution lorem)
- [ ] T110 Short string columns (character-class fake strings, or shuffle option)
- [ ] T111 Latitude and longitude columns and combined coordinate columns (bounding box, precision, pair detection)
- [ ] T112 Fuller handling of empty and single-value columns beyond the basics

### Later versions

- [ ] T113 Multi-table hierarchy (parent and child keys, generation order)
- [ ] T114 Cross-column rules (A at least B, sequences, derived columns)
- [ ] T115 Zone-based coordinates inside user-supplied polygons
- [ ] T116 Codebook import for labels and sentinels
- [ ] T117 SPSS and Stata input
- [ ] T118 Auto-generated agent README describing known oddities of the fake data

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: needs Setup; blocks every story. The prototypes (T015 to T018) must
  finish before the tasks they gate: T016 gates T091, T017 gates T120, T018 gates T092
- **US1 (Phase 3)**: needs Foundational; this is the MVP
- **US2 (Phase 4)**: needs US1 (it extends the review screen and profile messages)
- **US3 (Phase 5)**: needs US1; independent of US2 except for shared review-card files
- **US5 (Phase 6)**: needs Foundational; can run in parallel with US2 and US3
- **US4 (Phase 7)**: needs US1; the ID parts of the spec need US3
- **US6 (Phase 8)**: needs US1 (and US2 for filters over the virtual list)
- **Polish (Phase 9)**: needs all stories

### Within each story

Tests first and failing, then pure logic in `src/lib`, then workers, then screens.

### Parallel opportunities

- Setup: T002 to T006 and T008 together
- Foundational: T009 to T011 (brand), and T019 to T026 (pure core) are all different files
- US1: tests T028 to T032 together; T033, T034, T040, T041, T045 together
- US3 and US5 can be built by different people at the same time after US1

## Implementation Strategy

### MVP first (US1 only)

1. Phases 1 and 2, with the four prototypes
2. Phase 3, then stop and validate quickstart scenarios A and G
3. Demo to the maintainer before continuing

### Incremental delivery

US2 and US3 and US5 next (all P1), then US4 and US6 (P2), then Polish. Re-run `/speckit-converge`
after each phase so the task list always reflects what is truly left.

## Notes

- Never commit large fixtures or any real data; `.fixtures/` is gitignored
- Never let a test, log or error message contain a real cell value
- Commit after each task or small group
