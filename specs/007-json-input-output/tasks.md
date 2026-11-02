# Tasks: JSON input and output

**Input**: Design documents from `/specs/007-json-input-output/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/spec-file-v5.md, contracts/json-output.md, quickstart.md

**Tests**: Included. The constitution (Principle VIII) requires tests for generators, validation and detection; the spec requires leak, request and read-back tests (FR-010, FR-016, SC-001, SC-002, SC-003, SC-005).

**Organization**: By user story. Stories 1 to 4 are all P1; story 1 (array) is the MVP and story 2 (lines) follows at almost no cost once it works.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 array in and fake array out, US2 one record per line, US3 null, missing and mixed keys, US4 nested keys refused and nothing real kept
- Paths are from the repository root

---

## Phase 1: Setup

- [x] T001 Bump `package.json` to `0.4.0`; set `SPEC_VERSION` to 5 and `READABLE_SPEC_VERSIONS` to `[5]` in `src/lib/spec/types.ts` (beta: no older versions, research R8); delete the tests and fixtures that load version 1 to 4 specs, update the tests that pin the version, and amend `.specify/memory/constitution.md` Principle IV with "JSON form, key order, null versus missing and layout" (patch bump 1.0.1)
- [ ] T002 [P] `scripts/make-json-fixtures.py` writing `.fixtures/json/` (gitignored) and small committed copies under `tests/fixtures/json/`: `survey.json` (every kind: whole number, decimal, text, yes or no, date text, ID text), `survey.ndjson`, `survey_crlf_bom.json`, `nulls_missing.json` (one key null in some records, one absent in some, one both), `mixed.json` (numbers and text in one key), `nested.json` (an object key and a list key), `markers.json` (planted marker strings in values, nested values and the key text of nested objects), `pretty2.json`, `pretty4.json`, `tab.json`, and damaged files (`damaged.json`, `scalar.json`, `items.json`, `dup.json`, `empty.json`, `geojson.json`, `comments.json`)
- [ ] T003 Self-host the JSON reader: add `json` to `EXTENSIONS` in `scripts/fetch-extensions.mjs` (and to the file lists in `scripts/verify-release.mjs` and `scripts/build-release.mjs`), extend `src/lib/duckdb/extension.ts` if the name is hard-coded, and keep `public/duckdb-ext/VERSION.json` checks working
- [ ] T003a [P] Browser smoke test `tests/e2e/json-extension.spec.ts`: in the built app under the strict content policy, load `json` from the site (a `jsonSmoke` in `src/spikes/main.ts`), read a small array and a small lines file, and make zero requests outside the site; add it to the CI step in `.github/workflows/release.yml` beside `excel-extension parquet-extension`

---

## Phase 2: Foundational (blocks all stories)

- [ ] T004 [P] Unit tests for detection in `tests/unit/json-detect.test.ts`: form from the first bytes (array, lines, refused), byte-order mark, line ending (LF, CRLF), trailing newline, indent (2, 4, tab, compact, other), a one-record file, whitespace before the first bracket, and that only whitespace and the first bracket are ever inspected
- [ ] T005 [P] Unit tests for kinds in `tests/unit/json-kinds.test.ts`: per-key type counts to a kind (all numbers including integer and decimal together, all text, all boolean, null-only, object, array, number and text mixed, boolean and number mixed), `nulls` and `missing` counts, the mixed warning, and first-seen key order with keys that shift between records (`arg_min` rule of research R3)
- [ ] T006 [P] Unit tests for conversion in `tests/unit/json-convert.test.ts`: rendered cell text to a JSON token per kind (number as a valid JSON number, narrowing of a value that is not a valid number, text escaping of `"`, `\` and control characters with non-ASCII kept as UTF-8, booleans, `null`), and that nothing yields `NaN` or `Infinity`
- [ ] T007 [P] Unit tests for the writer in `tests/unit/json-writer.test.ts`: array and lines forms, each indent, LF and CRLF, trailing newline on and off, byte-order mark, key order, a key omitted from exactly `missing` records and `null` in exactly `nulls` records (chosen by the key's own sub-seeded generator and stable when another key changes), identical bytes for the same input twice, chunked output equal to unchunked
- [ ] T008 Implement `src/lib/json/types.ts`, `detect.ts` and `kinds.ts` to pass T004 and T005
- [ ] T009 Implement `src/lib/json/convert.ts` and `writer.ts` to pass T006 and T007
- [ ] T010 [P] Add the `json_*` error codes with fixed messages in `src/lib/errors.ts` (`json_empty`, `json_not_records`, `json_malformed`, `json_duplicate_key`, `json_too_large`, `json_unsupported_form`) and a test that no message contains text from a file or from the engine's message
- [ ] T011 [P] Spec version 5 in `src/lib/spec/types.ts`, `validate.ts`, `build.ts`, `toProfiles.ts` and `specs/001-csv-synthetic-slice/contracts/spec-file.schema.json`: the `json` source variant (form, indent, line ending, trailing newline, bom), `json_kind`, `json_nulls` and `json_missing` on columns, the validation of data-model.md, with tests in `tests/unit/spec-validate-json.test.ts` including that a CSV, Excel or Parquet spec with a `json_*` field is refused

**Checkpoint**: detection, kinds, conversion, the writer and the spec format exist and are tested.

---

## Phase 3: User Story 1 - A JSON array in, a fake JSON array out (Priority: P1) 🎯 MVP

**Goal**: choose a JSON array file, see its structure, profile like a CSV, generate and download a fake `.json` that two independent readers open.

**Independent Test**: `npx playwright test json-flow` and `npx vitest run json-load json-readback`.

- [ ] T012 [P] [US1] Integration test `tests/integration/json-load.test.ts` (Node engine): registering `survey.json`, `inspectJson` returns record count, key names in first-seen order and kinds, and `loadJson` builds the all-text table (numbers as text with a trailing `.0` removed from whole doubles, `true` and `false`, empty text token, NULL); no value is in the inspect result
- [ ] T013 [P] [US1] Read-back test `tests/integration/json-readback.test.ts`: write a file with `writeJson` from a synthetic spec and read it with Python-equivalent strict parsing (`JSON.parse`) and with the Node engine (`read_json`); keys, order and value kinds match the spec
- [ ] T014 [US1] Implement `src/workers/profile/json.ts`: `inspectJson` (queries of research R2 only; refuses a non-record item, a repeated key, an empty file) and `loadJson` (the typed to all-text conversion of research R3, nested keys as all-NULL, mixed keys as text)
- [ ] T015 [US1] Worker and protocol: detect JSON by content in `src/workers/profile.worker.ts` (the first non-space character, never the extension), add `inspectJson`/`jsonInfo` messages to `src/workers/protocol.ts`, map every failure to the fixed messages of T010, discard the engine's message, load the extension before reading
- [ ] T016 [US1] Generation: `src/lib/generate/json.ts` (`jsonLayoutOf(spec)`, `writeJson(spec, seed, chunkRows, observe, between)` using the CSV path's rendering and `convert.ts`), the JSON branch in `src/lib/generate/table.ts` and `src/workers/generate.worker.ts` streaming chunks
- [ ] T017 [US1] App: `src/app/session.ts` (file kind, `fakeBlob` mime `application/json`, the file name with `_fake` keeping `.json`, `.ndjson` or `.jsonl`), `src/features/ingest/IngestScreen.tsx` accepts `.json`, `.ndjson` and `.jsonl` and tells the user "One file at a time", a `JsonSummary` card in `src/features/ingest/` (record count, form, keys with kinds, no value) using the tooltip component for notes, the size warning in `sizeWarnings.ts` (research R7)
- [ ] T018 [P] [US1] Component test `tests/component/json-ingest.test.tsx`: the card shows names, kinds and counts and no value; the size warning and stop; refused files show the fixed messages
- [ ] T019 [P] [US1] End-to-end test `tests/e2e/json-flow.spec.ts`: choose `survey.json`, review, generate, download, then read the download with the same code as the real file (`JSON.parse`) and the app's own engine, and compare keys, order and value kinds; check the file name is `survey_fake.json`

**Checkpoint**: an array round trip works through the app.

---

## Phase 4: User Story 2 - One record per line (Priority: P1)

**Goal**: NDJSON and JSON Lines files work the same way and come out in the same form.

**Independent Test**: `npx playwright test json-flow -g lines` and `npx vitest run json-load json-readback`.

- [ ] T020 [P] [US2] Extend `tests/integration/json-load.test.ts` and `json-readback.test.ts` to `survey.ndjson` and `survey_crlf_bom.json`: form detected by content whatever the extension, CRLF and the byte-order mark recorded and reproduced, blank lines tolerated on read
- [ ] T021 [P] [US2] Extend `tests/e2e/json-flow.spec.ts` with the lines file: the download has one complete record per line, no brackets, no commas between records, the extension kept (`.ndjson`, `.jsonl`)
- [ ] T022 [US2] Make the form follow the spec: an array spec writes an array and a lines spec writes lines, in `src/lib/generate/json.ts` and the Generate screen note that states the form and layout; a `.json` file with one record per line is a lines file

**Checkpoint**: both forms round trip.

---

## Phase 5: User Story 3 - Null, missing and mixed keys (Priority: P1)

**Goal**: how often a key is `null`, absent or mixed is kept as structure; no value is kept.

**Independent Test**: `npx vitest run json-load json-readback` with `nulls_missing.json` and `mixed.json`, and the keys in `json-flow`.

- [ ] T023 [P] [US3] Integration tests: `nulls_missing.json` gives the recorded `json_nulls` and `json_missing` per key, and the written file has exactly those counts of `null` and absent keys (SC-005); `mixed.json` loads as text with the `mixed_kinds` reason
- [ ] T024 [P] [US3] Component test: the review card shows the mixed warning as a tooltip, a null-only key reads as an all-missing column, and the type shown for each kind matches the spec's `json_kind`
- [ ] T025 [US3] Carry kinds and counts through profiling and the spec: `src/lib/spec/build.ts` and `toProfiles.ts` write and read `json_kind`, `json_nulls`, `json_missing`; `src/workers/profile.worker.ts` keeps them through re-profiling and type overrides; the writer follows the recorded kind when the user changes a column's profiled type (a numeric key changed to category still writes numbers; a text key changed to number is refused with a plain message)
- [ ] T026 [US3] The `mixed_kinds` reason in `src/lib/profile/types.ts` with its fixed text in `src/features/review/summary.ts`, shown on the card and in the attention list

**Checkpoint**: null, missing and mixed behave as specified.

---

## Phase 6: User Story 4 - Nested keys refused, nothing real kept (Priority: P1)

**Goal**: objects and lists are marked unsupported and never read; no value or key text beyond key names reaches the page, spec, preview, output, errors, console or storage.

**Independent Test**: `npx vitest run json-privacy` and `npx playwright test json-privacy`.

- [ ] T027 [P] [US4] Spy test `tests/integration/json-privacy.test.ts`: a runner that records every row the engine returns to the caller while `markers.json` is inspected, loaded and profiled; fails if any marker (in values, nested values or nested key names) appears in any returned row except inside the table load that stays in the worker
- [ ] T028 [P] [US4] Output test in `tests/unit/json-writer.test.ts` and `tests/integration/json-readback.test.ts`: the fake file holds no marker, no nested key name, an unsupported key is omitted by default and `null` in every record when kept
- [ ] T029 [P] [US4] End-to-end leak test `tests/e2e/json-privacy.spec.ts`: run the whole flow on `markers.json` and search page text, spec JSON, preview, the downloaded file's bytes, console messages, local and session storage and every error message for any marker; assert zero outside requests (SC-002, SC-003)
- [ ] T030 [P] [US4] Refusal tests: `damaged.json`, `scalar.json`, `items.json`, `dup.json`, `empty.json`, `geojson.json` and `comments.json` each end in the fixed message with no file content (`tests/integration/json-load.test.ts`, `tests/e2e/json-flow.spec.ts`)
- [ ] T031 [US4] Reason codes `nested_object` and `nested_array` in `src/lib/profile/types.ts` with fixed texts in `src/features/review/summary.ts`; the kept-as-null handling in the writer and spec validation (an unsupported key holds no `json_nulls` count from inside the value); make T027 to T030 pass

**Checkpoint**: the privacy claim is tested at the query, the file and the browser levels.

---

## Phase 7: Polish and Cross-Cutting

- [ ] T032 [P] Loading a JSON spec without the file: `Session.loadSpecFile` accepts version 5, the output form follows `source.form`, CSV, Excel and Parquet specs keep their formats; tests in `tests/component/spec-load.test.tsx` and `tests/e2e/json-flow.spec.ts` (SC-004: same spec and seed, same bytes)
- [ ] T033 [P] Offline release: add a JSON session to `tests/e2e/offline-zip.spec.ts` (output equal to the hosted build's), and confirm `verify-release` lists the `json` extension files in the checksum list
- [ ] T034 [P] Accessibility: extend `tests/e2e/a11y.spec.ts` to the JSON summary card and the mixed and unsupported tooltips in light and dark themes
- [ ] T035 [P] Browser matrix: add `json-flow` and `json-privacy` to the Firefox and WebKit `testMatch` in `playwright.config.ts` and to `scripts/e2e-browsers.mjs`; run Chromium, Edge (`PW_EDGE=1`), Firefox and WebKit
- [ ] T036 [P] Docs: Help guide, `SpecContentsNotice.tsx` (a JSON spec holds the file name, form, layout, key kinds and null and missing counts, no value), `README.md`, and the file-type chips on the start screen
- [ ] T037 Large file: `python scripts/make-json-fixtures.py --large` writes a file of about 500 MB of expanded data to `.fixtures/`; add `tests/e2e/json-scale.spec.ts` gated by its presence (SC-006)
- [ ] T038 Record in `research.md` the bundle size, audit notes (no new dependency) and the measured results; run quickstart scenarios 1 to 6 and record results and the SC-009 person sign-off line as open
- [ ] T039 Run `/speckit-converge`, tag nothing, and mark the slice complete

---

## Dependencies and order

- Phase 1, then Phase 2 (tests T004 to T007 before T008 and T009).
- US1 is the MVP and needs Phase 2. Within US1: tests T012 and T013 first, then T014 to T017.
- US2 needs US1's loader and writer and mostly adds tests and the form switch. US3 needs the kind mapping (T008) and the loader (T014). US4 needs US1 (the flow to attack); T027 and T028 can start as soon as T014 and T009 exist.
- Polish last.

## Parallel examples

- Phase 2: T004 to T007 are different files; so are T010 and T011.
- US1: T012 and T013 together; T018 and T019 together after T017.
- US2, US3 and US4 beside each other once US1 is done.

## Implementation strategy

MVP first: Phases 1 to 3 give a working array round trip. Then US2 adds the lines form, US3 the null, missing and mixed structure, US4 proves the privacy claim. Commit after each task group.
