# Implementation Plan: Personal Identifier, Free Text and Short String Columns

**Branch**: `002-personal-text-columns` | **Date**: 2026-10-31 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-personal-text-columns/spec.md`

## Summary

Columns that slice 1 leaves out (personal data, free text, high-variety strings) become
generatable. Three new column types are added to the spec file: `personal` (a kind such as
`email`, with a repeat structure), `free_text` (a length distribution) and `short_string` (a
per-position pattern plus lengths and a repeat structure). Generation reuses the slice 1
machinery: sub-seeded pure functions of the row, the NA and sentinel placer, the repeat-structure
buckets and keyed bijection of ID columns, and the numeric generator for lengths. Invented values
are composed from the en_US word lists of `@faker-js/faker` by mixed-radix indexing through a keyed
bijection, so every distinct value is unique by construction and no value is ever stored or
looked up. Profiling reads only counts, lengths, shapes and the repeat structure. Faker data is
bundled only in the generate worker; the Review screen gets live samples from that worker.

## Technical Context

**Language/Version**: TypeScript 5.9 strict, Node 24 for tooling and CI (unchanged from slice 1)

**Primary Dependencies**: existing stack (React 18, Vite 5, DuckDB-WASM, valibot); `@faker-js/faker` 10.x moves from development to runtime dependency, imported only by the generate worker

**Storage**: none (session memory only; spec JSON file is the only artifact)

**Testing**: Vitest (unit, integration with DuckDB in Node, component), Playwright (Chromium, Edge, Firefox, WebKit)

**Target Platform**: browsers, static hosting on GitHub Pages

**Project Type**: single-page web app with two workers (profile, generate)

**Performance Goals**: slice 1 targets hold: 500 MB and 120 columns profile in under 5 minutes and generate and export in under 5 minutes; invented values at several million per second per column

**Constraints**: no network; no real value stored, shown, saved or returned; deterministic output; profile worker must not contain faker data; spec stays under 1 MB (names column under 100 KB)

**Scale/Scope**: columns of up to millions of distinct invented values; en_US only; 3 new spec types; about 8 personal kinds

## Constitution Check

| Principle | Check | Result |
|---|---|---|
| I Privacy first | Profiling returns counts, lengths, shapes only; frequent-value fetch is skipped for these columns; generator makes no request; leak tests extended (FR-008, FR-014) | Pass |
| II Minimal derived artifact | Spec holds kind, repeat structure, shape, lengths, NA counts; validator rejects any value-bearing field; personal values come from faker word lists, never from real data | Pass |
| III Client-only static deployment | No backend; faker is a bundled npm package | Pass |
| IV Format fidelity | Phone and email shape classes kept; free text line breaks quoted as in the source; per-column quoting unchanged | Pass |
| V Reproducibility | Per-column sub-seed, pure function of row; check table gains distinct, repeat, length checks | Pass |
| VI User control | Kind selector, explanation, live sample, exclude; SSN-style needs explicit acknowledgement | Pass |
| VII Brand and accessibility | Reuses tokens and components; axe checks extended to the new editors | Pass |
| VIII Test-driven core | Generators and composers are pure TypeScript with unit tests first | Pass |
| IX Scale | Composition from arrays with no per-value library calls; chunked generation unchanged | Pass |
| X Progress tracking | tasks.md for this feature; slice 1 deferred items T108 to T110 are superseded by this feature | Pass |

No violations; Complexity Tracking is empty. Re-checked after design: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/002-personal-text-columns/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── spec-file-v2.md
└── tasks.md             # created by /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── spec/            # types.ts, validate.ts, build.ts, toProfiles.ts: new column types, version 2
│   ├── classify/        # classify.ts: personal kinds, free text, short string; stats.ts: length and shape fields
│   ├── textgen/         # NEW, pure: wordlists.ts (loaded in generate worker only), compose.ts,
│   │                    #   personal.ts (kinds), phone.ts, lorem.ts, shortstring.ts, ssn.ts
│   ├── generate/        # column.ts and checks.ts: cases for the three types
│   └── profile/         # types.ts, edits.ts: kind and shape edits, SSN acknowledgement
├── workers/
│   ├── profile/         # personal.ts (NEW): aggregates for the three types; stats.ts skips frequent values
│   ├── generate.worker.ts   # new "sample" request for live samples
│   └── protocol.ts
└── features/review/     # PersonalKindEditor.tsx (NEW), ShortStringEditor.tsx (NEW), card summaries

tests/
├── unit/                # textgen composers, bijection uniqueness, classify, validate, checks
├── integration/         # personal-inference.test.ts (spy), text-privacy.test.ts, roundtrip updates
├── component/           # kind editor, SSN acknowledgement, samples
├── e2e/                 # leak test extended, bundle check, a11y extended
└── fixtures/zoo/        # new text columns in make-fixtures.mjs and expected.json
```

**Structure Decision**: extend the slice 1 layout. The pure composers live in a new
`src/lib/textgen/` folder so they can be tested without a browser and imported only by the
generate worker. Word lists are in one module (`wordlists.ts`) that nothing else imports, which
keeps faker data out of the profile worker and the main bundle; a test scans the built bundles.

## Complexity Tracking

No constitution violations to justify.
