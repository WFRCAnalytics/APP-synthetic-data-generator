# Tasks: Personal Identifier, Free Text and Short String Columns

**Input**: Design documents from `/specs/002-personal-text-columns/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/spec-file-v2.md, quickstart.md

**Tests**: Included. The constitution (Principle VIII) requires tests for generators, validation and detection, and spec FR-014 requires the leak tests. Write each test first and see it fail.

**Organization**: By user story. Stories 1 and 4 are P1; stories 2 and 3 are P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 personal identifiers, US2 free text, US3 short strings, US4 nothing real is kept
- Paths are from the repository root

---

## Phase 1: Setup

- [x] T001 Move `@faker-js/faker` from devDependencies to dependencies in `package.json` and run `npm install`; confirm only `src/lib/textgen/wordlists.ts` will import it (add an ESLint `no-restricted-imports` rule for `@faker-js/faker` everywhere else in `eslint.config.js`, allowing `src/lib/textgen/wordlists.ts` and `scripts/` and `tests/`)
- [x] T002 [P] Extend `scripts/make-fixtures.mjs` with text columns in `zoo_small.csv` (full name, first name, last name, email, phone in three formats, street address, URL, IP, SSN-like, comments, plate, vendor code, a mixed email-and-text column) and a new `tests/fixtures/zoo/text_50k.csv` (50,000 distinct invented-looking names, emails, phones, addresses, with repeats and NA tokens); update `tests/fixtures/zoo/expected.json` with the new expected types and reasons, then regenerate fixtures. Fixture "real" values must be synthetic strings that do not come from faker's word lists (use a seeded script with its own lists) so the leak tests can tell a real value from an invented one
- [x] T003 [P] Record the current size of the generate worker, profile worker and main bundles in `specs/002-personal-text-columns/research.md` (baseline for R11)

---

## Phase 2: Foundational (blocks every story)

- [x] T004 [P] Unit tests for the spec changes (version 1 and 2 accepted, 3 refused with the newer-version message, the three new types validated, extra keys rejected, `ssn` without acknowledgement rejected) in `tests/unit/spec-validate-text.test.ts`
- [x] T005 Add `personal`, `free_text` and `short_string` column types, `PersonalKind`, `PersonalFormat` and `SPEC_VERSION = 2` (readers accept 1 and 2) to `src/lib/spec/types.ts`, the valibot schemas and cross-field rules in `src/lib/spec/validate.ts` (repeat structure covers the rows left after NA, length groups at most 64, pattern length equals the longest length, no additional properties), and the version messages
- [x] T006 [P] Update `specs/001-csv-synthetic-slice/contracts/spec-file.schema.json` for version 1 or 2 and the three new column types (copy the shapes from `contracts/spec-file-v2.md`), and add a schema-versus-validator consistency test to `tests/unit/spec-validate-text.test.ts`
- [x] T007 [P] Extend profile types in `src/lib/profile/types.ts`: summaries `personal`, `free_text`, `short_string`; reason codes `kind_mixed`, `suffix_needed`, `ssn_needs_acknowledgement`; `LocalEdits` fields `personalKind`, `ssnAcknowledged`, `shortPattern`, applied in `src/lib/profile/edits.ts` (with unit tests in `tests/unit/edits-filter.test.ts`)
- [x] T008 Update `src/lib/spec/build.ts` and `src/lib/spec/toProfiles.ts` to write and read the three types (round trip), and extend `tests/unit/spec-roundtrip.test.ts`
- [x] T009 [P] Unit tests for the composition core (bijection uniqueness over a space, mixed-radix decode, suffix extension beyond the natural space, determinism, chunk independence) in `tests/unit/textgen-compose.test.ts`
- [x] T010 Implement `src/lib/textgen/compose.ts`: `mixedRadix(index, radices)`, `makeUniqueSpace(naturalSpace, key)` returning `{space, valueIndexAt(group)}` that adds a numeric suffix counter beyond the natural space, built on `makePermutation` and `makePermutationBig`
- [x] T011 Generalize the repeat-structure bucketing from `src/lib/generate/survey-id.ts` into a shared `src/lib/generate/groups.ts` (`makeGroupMapper(repeatStructure, key, space)` returning rank to group index) and make `survey-id.ts` use it, keeping `tests/unit/mask.test.ts` and the ID tests green
- [x] T012 [P] Add the generate worker `sample` request and `samples` reply to `src/workers/protocol.ts` and `src/workers/generate.worker.ts` (up to 10 invented values for a column description, no real data), with a unit test of the handler in `tests/unit/sample-request.test.ts`
- [x] T013 Change `collectBasic` in `src/workers/profile/stats.ts` so frequent and unparsed values are not fetched for string-like columns (fewer than half the values numeric) whose distinct count exceeds the categorical limit; numeric columns keep fetching them; add the built-in sentinel vocabulary match returning counts only; add a regression test in `tests/integration/profile.test.ts` that a high-cardinality numeric column still finds its sentinels (research R6)
- [x] T014 [P] Add length and shape aggregates to `BasicStats` in `src/lib/classify/stats.ts` and the SQL that fills them in `src/workers/profile/stats.ts` (mean, sd and 101 quantiles of length, share of values with spaces, share with line breaks, count of values with letters, digits and punctuation); no value is returned

**Checkpoint**: spec types, composition core and sample plumbing exist; nothing is detected or generated yet.

---

## Phase 3: User Story 1 - Names, emails, phones, addresses (Priority: P1) MVP

**Goal**: personal columns are detected, confirmed on Review with a live sample, and generated with the real distinct count, repeat structure and NA counts.

**Independent Test**: Quickstart scenario A.

### Tests for User Story 1

- [x] T015 [P] [US1] Unit tests for detection of personal kinds from shapes and column names, mixed columns (`kind_mixed`), SSN-style left unsupported until acknowledged, and unchanged behavior for other types, in `tests/unit/classify-personal.test.ts`
- [x] T016 [P] [US1] Unit tests for each composer (full, first, last name; email; phone with shapes; address; URL; IPv4; SSN with 9xx area): values match the kind's format, are unique across the space, never in assigned ranges for SSN, deterministic, in `tests/unit/textgen-personal.test.ts`
- [x] T017 [P] [US1] Unit tests that a personal column keeps its repeat structure, distinct count and NA and sentinel counts exactly, across chunk sizes, in `tests/unit/generate-personal.test.ts`
- [x] T018 [P] [US1] Component tests for the kind editor (kind change updates the sample through a mocked worker, explanation text, the suffix note, SSN acknowledgement toggles generation) in `tests/component/review-personal.test.tsx`

### Implementation for User Story 1

- [x] T019 [US1] Create `src/lib/textgen/wordlists.ts` (the only importer of `@faker-js/faker`, reading the en_US definitions for first and last names, street suffixes, city names, states, free email domains, and a small set of URL words) and export plain arrays
- [x] T020 [US1] Implement the composers in `src/lib/textgen/personal.ts`, `src/lib/textgen/phone.ts` and `src/lib/textgen/ssn.ts` per R3 and R8, each returning `{space, valueAt(index)}` and honoring the profiled `format`
- [x] T021 [US1] Extend `classifyColumn` in `src/lib/classify/classify.ts` to return `personal` with a proposed kind instead of `unsupported` (R5), reason `kind_mixed` below 80% shape share, and `unsupported` plus `ssn_needs_acknowledgement` for SSN-style columns
- [x] T022 [US1] Create `src/workers/profile/personal.ts`: repeat structure (reuse `repeatStructure` from `ids.ts`), distinct count, format shapes (at most 5 with shares), name `last_first`, address `unit` and `zip4`; wire it into `src/workers/profile/profiler.ts` for the `personal` case, never returning a value
- [x] T023 [US1] Add the `personal` case to `src/lib/generate/column.ts` (placer for NA and sentinels, group mapper, composer, suffix when the group count exceeds the natural space) and the checks in `src/lib/generate/checks.ts` (`distinct_count`, `repeat_structure`, `na_count`, `sentinel_counts`)
- [x] T024 [US1] Build `src/features/review/PersonalKindEditor.tsx`: kind selector, explanation text, live sample (via a new `session.requestSamples` using the generate worker), suffix note, SSN acknowledgement checkbox; mount it in `ColumnEditors.tsx`; add the kind labels and reason texts to `src/features/review/summary.ts`
- [x] T025 [US1] Update `ExcludeControl.tsx`, `AttentionBanner.tsx` and the card summary lines so personal columns show "Invented values, N distinct" and never a value
- [x] T026 [US1] Integration test for profiling the personal fixtures against `expected.json` and a roundtrip generate and re-profile (same distinct count, repeat structure, NA counts) in `tests/integration/personal-profile.test.ts` and update `tests/integration/roundtrip.test.ts`
- [x] T027 [US1] Mark slice 1 deferred tasks T108 (personal identifiers), T109 (free text) and T110 (short strings) superseded in `specs/001-csv-synthetic-slice/tasks.md` with a pointer to this feature

- [x] T056 [US1] Add the new types to the Type selector choices in `src/features/review/ColumnEditors.tsx` and forced-type support in `src/workers/profile/profiler.ts` (`forceType`), so a slice 1 unsupported column can be switched to a kind when the file is open; in spec-only mode disable the selector for unsupported columns with the reason `needs_source_file` and the explanation (FR-017, research R7b); tests in `tests/component/review-personal.test.tsx` and `tests/integration/personal-profile.test.ts`
- [x] T057 [US1] Card notes and warnings in `PersonalKindEditor.tsx` and `src/features/review/summary.ts`: non-English characters note for names and free text, the mix of phone formats with shares shown for confirmation, and the warning when a personal column is switched to numeric or categorical (real labels would be kept in the spec); component tests in `tests/component/review-personal.test.tsx`
- [x] T058 [P] [US1] Extend `tests/helpers/fakeWorkers.ts` to answer the `sample` request and make `Session` create the generate worker lazily for samples in `src/app/session.ts` (`requestSamples`), so Review samples work before any generation

**Checkpoint**: a table with name, email, phone and address columns generates with exact distinct and NA counts. MVP.

---

## Phase 4: User Story 4 - Nothing real is kept (Priority: P1)

**Goal**: the leak guarantees of FR-008, FR-009, FR-014, FR-015 and SC-002 are enforced by tests, for every new column type.

**Independent Test**: Quickstart scenario D.

### Tests for User Story 4

- [x] T028 [P] [US4] Spy integration test: record every row the engine returns while profiling the personal, free text and short string fixture columns and fail if any real value appears; confirm no frequent-value query runs for them, in `tests/integration/personal-inference.test.ts`
- [x] T029 [P] [US4] Spec privacy test: the spec for `text_50k.csv` holds none of the real values, is under 100 KB, and a hand-edited spec with a `values` list on a new column type is rejected, in `tests/integration/text-privacy.test.ts`
- [x] T030 [P] [US4] Browser leak test: extend `tests/e2e/privacy.spec.ts` so the new fixture columns (real names, emails, phones, addresses, comment words, codes) never appear in the page text, the spec download, the preview, the fake file or error messages
- [x] T031 [P] [US4] Bundle test `tests/unit/bundle-wordlists.test.ts` (run after `npm run build`, skipped when `dist` is absent): the profile worker bundle and the main bundle contain none of a list of faker word-list marker strings, and the generate worker bundle does

### Implementation for User Story 4

- [x] T032 [US4] Make the validator in `src/lib/spec/validate.ts` report a clear, per-column message for a value-bearing key on the new types, and ensure error messages never quote a value (extend `tests/unit/errors.test.ts`)
- [x] T033 [US4] Add CI wiring: run the bundle test after the build step in `.github/workflows/deploy.yml`

**Checkpoint**: every guarantee has a failing-if-broken test.

---

## Phase 5: User Story 2 - Free text (Priority: P2)

**Goal**: free text columns are detected and generated with the real length distribution.

**Independent Test**: Quickstart scenario B.

### Tests for User Story 2

- [x] T034 [US2] Unit tests for free text detection (mean length, spaces, names like comment) in `tests/unit/classify-text.test.ts`
- [x] T035 [P] [US2] Unit tests for the lorem generator and the free text column: exact min and max length, spread follows quantiles, no real word, line breaks only when `line_breaks`, determinism, in `tests/unit/generate-free-text.test.ts`
- [x] T036 [P] [US2] Component test for the free text card (length summary, explanation, sample) in `tests/component/review-free-text.test.tsx`

### Implementation for User Story 2

- [x] T037 [US2] Implement `src/lib/textgen/lorem.ts` (own small word list, sentence punctuation, cut at the chosen length) and the `free_text` case in `src/lib/generate/column.ts` reusing the numeric length generator; add `min`, `max` checks in `checks.ts`
- [x] T038 [US2] Extend `classifyColumn` and `src/workers/profile/personal.ts` (or `text.ts`) to return `free_text` with the length fields and `line_breaks`, and the card summary for it
- [x] T039 [US2] Quote embedded line breaks as the source did: add a case with line breaks to `tests/unit/csv-writer.test.ts` and confirm `src/lib/csv/writer.ts` quotes them under every quote style
- [x] T059 [US2] Cap free text lengths at 100,000 characters in the profiler and validator, with the reason `text_length_capped` and a card note; tests in `tests/unit/generate-free-text.test.ts` and `tests/unit/spec-validate-text.test.ts`
- [x] T040 [US2] Integration test profile then generate then re-profile the comments column in `tests/integration/text-roundtrip.test.ts`

**Checkpoint**: comments columns keep lengths and no word.

---

## Phase 6: User Story 3 - Short strings (Priority: P2)

**Goal**: high-variety short strings are detected and generated with the real patterns, lengths and distinct count.

**Independent Test**: Quickstart scenario C.

### Tests for User Story 3

- [x] T041 [P] [US3] Unit tests for short string detection (not ID-named, distinct above the limit, not personal) in `tests/unit/classify-text.test.ts`
- [x] T042 [P] [US3] Unit tests for the short string generator: pattern and length per value, `length_groups` counts exact, distinct count and repeat structure exact, determinism, in `tests/unit/generate-short-string.test.ts`
- [x] T043 [P] [US3] Component tests for the pattern editor and sample in `tests/component/review-short-string.test.tsx`

### Implementation for User Story 3

- [x] T044 [US3] Implement `src/lib/textgen/shortstring.ts` (prefix of the pattern by length, per-length space and bijection via `compose.ts` and `groups.ts`) and the `short_string` case in `column.ts` and checks (`length_groups`, `distinct_count`, `repeat_structure`)
- [x] T045 [US3] Profile short strings in `src/workers/profile/personal.ts`: per-position classes for the longest length (reuse `tokenForPosition`), `length_groups`, repeat structure; classification in `classify.ts`
- [x] T046 [US3] Build `src/features/review/ShortStringEditor.tsx` (reuse the ID token editor parts from `IdMaskEditor.tsx` where possible) with the shortfall message and Generate gating as for IDs (`narrowIdColumns` generalized in `src/lib/profile/idCapacity.ts`)
- [x] T060 [US3] Make the short string shortfall (FR-013) block Generate with the ID-style message and no suffix; test in `tests/component/review-short-string.test.tsx`
- [x] T047 [US3] Integration test profile then generate then re-profile the plate and vendor code columns in `tests/integration/text-roundtrip.test.ts`

**Checkpoint**: no string column is left out for being text.

---

## Phase 7: Polish & Cross-Cutting

- [x] T061 [P] Extend `tests/unit/determinism.test.ts` with personal, free text and short string columns: byte-identical output across chunk sizes and seeds, and changing one of them changes no other column (SC-003)
- [x] T062 Record the person-timing sign-off lines for SC-008 (and the slice 1 SC-007 and SC-008) in this feature's `quickstart.md`
- [x] T048 [P] Extend `tests/e2e/a11y.spec.ts` to open the new editors in light and dark themes and fix any violation
- [x] T049 [P] Browser tests for the whole slice 2 flow and spec save, reload, load in `tests/e2e/quickstart.spec.ts` (scenarios A, D, E, F) in Chromium, then run `npm run test:e2e:browsers`
- [x] T050 [P] Update `src/app/HelpGuideModal.tsx`, `src/features/review/SpecContentsNotice.tsx` and `README.md` for the new column kinds and the "not in this version" list
- [x] T051 Measure the generate worker bundle growth against the 1.5 MB budget and record it in `research.md` (R11); lazy-load by kind if exceeded
- [x] T052 Run the 500 MB fixture with text columns (`SCALE_500MB=1 npx playwright test scale.spec`), extend `scripts/make-fixtures.mjs --large` with text columns if absent, and record the timings in `quickstart.md`
- [x] T053 Dependency audit update in slice 1 `research.md` (faker is now a runtime dependency; confirm it makes no requests) and deploy to Pages by pushing to main
- [x] T054 Run quickstart scenarios A to F in Chrome, Edge, Firefox and WebKit and record results in this feature's `quickstart.md`
- [x] T055 Run `/speckit-converge` and mark the slice complete
  - Converge run 2026-10-31: no code gaps against FR-001 to FR-017 and SC-001 to SC-007, so nothing was appended. One edge case (sentinel-like words in a name column) had code but no test; it now has one. Open item that is not code: the maintainer sign-off for the person-timing check SC-008 (see `quickstart.md`).

---

## Dependencies and Order

- Phase 1 then Phase 2, which blocks everything.
- US1 (Phase 3) is the MVP and needs Phase 2. US4 (Phase 4) needs US1's columns to test, but its test tasks can be written beside US1. US2 and US3 need Phase 2 and are independent of each other; US3 reuses ID editor code from slice 1 only.
- Within a story: tests first, then wordlists and composers, then classify and profile, then generate and checks, then UI.
- Polish after the stories.

## Parallel Examples

- Phase 2: T004, T006, T007, T009, T012, T014 touch different files and can run together.
- US1 tests T015 to T018 can be written in parallel.
- US4 tests T028 to T031 can be written in parallel.
- US2 and US3 phases can proceed in parallel after Phase 2.

## Implementation Strategy

1. MVP: Phases 1, 2 and 3 (names, emails, phones, addresses generate with exact counts).
2. Add US4 immediately after: the guarantees must exist before anything ships to the live site.
3. Add US2 then US3, committing after each phase.
4. Polish and release, deploying to GitHub Pages from main.

## Task Counts

| Phase | Tasks |
|---|---|
| Setup | 3 |
| Foundational | 11 |
| US1 | 16 |
| US4 | 6 |
| US2 | 8 |
| US3 | 8 |
| Polish | 10 |
| Total | 62 |

New IDs T056 to T062 were added after the analysis and sit in the phase they belong to, so earlier IDs did not change.
