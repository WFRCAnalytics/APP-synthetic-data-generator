# Implementation Plan: CSV Synthetic Data Slice

**Branch**: `001-csv-synthetic-slice` | **Date**: 2026-10-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-csv-synthetic-slice/spec.md`

## Summary

Deliver the first vertical slice: a WFRC-branded, fully client-side app that reads one private CSV,
profiles it, lets the analyst review and override every column decision, saves or loads a small
spec file, and generates and exports a fake CSV with the same shape, formats and exact summaries.

Approach: DuckDB-WASM, running in a worker, reads and profiles the file from the browser `File`
without copying it into JavaScript memory (all-text table, statistics in SQL). Generation is a
separate worker that depends only on the spec: every value is a pure function of
`(seed, column, row)` built on keyed permutations, so memory stays flat, output is chunk-size
independent, and "same seed, same file" holds by construction. A meta Content-Security-Policy makes
the browser block cross-origin requests, and a counter shows the result. Details and alternatives
are in [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20+ for tooling

**Primary Dependencies**: React 18.3, Vite 5.4, `@duckdb/duckdb-wasm` (exact pin), `@tanstack/react-virtual`, `valibot`

**Storage**: None. Real data lives only in an in-memory database inside a worker; the saved spec is
a downloaded file; nothing is written to browser storage

**Testing**: Vitest 2 (unit, integration with DuckDB's Node bindings), React Testing Library
(component), Playwright (browser: file input, network counter, reload, 500 MB run)

**Target Platform**: Static site in current Chrome and Edge (full); Firefox and Safari with
single-file download

**Project Type**: Single-page web application (static, client-only)

**Performance Goals**: A ~500 MB, ~120-column CSV profiles in under 5 minutes and generates plus
exports in under 5 minutes, with progress shown and a responsive page (SC-001), measured on a
reference laptop (4 or more CPU cores, 16 GB of memory, current Chrome or Edge); CI runs only the
small-fixture version, and the 500 MB run is a manual check on the reference machine

**Constraints**: Zero cross-origin requests after load; no real value in the UI, spec or errors;
spec under 1 MB for a table with 50,000 IDs; WASM memory limit (32-bit, at most 4 GB); no `eval`
(the CSP forbids it)

**Scale/Scope**: One table per session; up to ~500 MB, 100 to 120+ columns, about 1 million rows;
3 screens, 10 column types (8 generated types, plus `empty` and `unsupported` handled specially)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How the plan satisfies it |
|---|---|---|
| I. Privacy First | Pass | Workers hold real data; UI gets summaries only; meta CSP blocks cross-origin; counter covers main thread and workers; error text carries no cell values (worker protocol) |
| II. Minimal Derived Artifact | Pass | Spec schema forbids ID lists, free text and coordinates; IDs are masks plus repeat structure; ID inference uses SQL aggregates so IDs never reach the JS heap; a test scans specs for fixture values |
| III. Client-Only Static Deployment | Deviation (justified) | Static, no backend: yes. Pages workflow, offline zip and Excel-extension CI test are a separate infrastructure feature (see Complexity Tracking). DuckDB version is pinned and binaries are self-hosted |
| IV. Format Fidelity | Pass | All-text read keeps raw tokens; encoder, quote style, line ending, BOM and date directives are modeled and round-trip tested |
| V. Reproducibility and Determinism | Pass | Pure-function generation with per-column sub-seeds; check table verifies exact metrics |
| VI. User Control and Transparency | Pass | Every detection is overridable; protections off by default; needs-attention flags and banner |
| VII. Brand Consistency and Accessibility | Pass | Copy `theme/tokens.css`, `app.css`, logo and header; tokens only; focus ring, keyboard operation, contrast tests |
| VIII. Test-Driven Correctness Core | Pass | Pure TypeScript core under `src/lib` with unit tests; integration and component layers planned |
| IX. Scale and Performance | Deviation (justified) | Streaming, virtualized list and progress included. Folder output through the File System Access API is deferred to a later feature (see Complexity Tracking) |
| X. Progress Tracking and Vertical Slices | Pass | Deferred items from the spec become explicit not-started tasks; converge at slice end |

**Post-design re-check (after Phase 1)**: unchanged. The design added the CSP, the permutation
approach and the worker split, all of which strengthen I, V and IX. No new violations.

## Project Structure

### Documentation (this feature)

```text
specs/001-csv-synthetic-slice/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── spec-file.schema.json
│   └── worker-protocol.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
index.html                     # CSP meta tag; mounts the app
package.json                   # exact DuckDB-WASM pin
vite.config.ts                 # base path for Pages; worker and wasm handling
tsconfig.json
.eslintrc.cjs, .prettierrc.json
scripts/
├── copy-duckdb.mjs            # copies binaries from node_modules into public/duckdb (no network)
├── make-fixtures.mjs          # small fixtures plus the 500 MB generator
└── verify-roundtrip.mjs       # parses real and fake with the same code
public/
└── duckdb/                    # gitignored; created by copy-duckdb
src/
├── main.tsx
├── App.tsx
├── app/                       # AppHeader, Stepper, LocalNotice, NetworkCounter, netCounter store, state reducer
├── components/                # Modal, Badge, EmptyState, SelectField, ConfirmDialog (copied from the reference)
├── features/
│   ├── ingest/                # file picker, settings confirmation, spec loader
│   ├── review/                # column list, ColumnCard, filters, banner, ID mask editor, date pattern box
│   ├── generate/              # seed, progress, preview table, check table, export
│   └── spec/                  # save, load and validate spec files
├── lib/                       # pure TypeScript core (unit-tested, no DOM)
│   ├── rng/                   # sfc32, sub-seed derivation, Feistel bijection, counter-based draws
│   ├── sampling/              # uniform, beta via gamma, quantile interpolation, rescale
│   ├── classify/              # type detection rules, sentinel and NA-token logic
│   ├── mask/                  # ID mask inference model, capacity, generation
│   ├── datefmt/               # supported directives, format and SQL translation
│   ├── csv/                   # writer, quoting, encoders (UTF-8, UTF-16, Windows-1252)
│   ├── encoding/              # BOM and encoding detection
│   ├── generate/              # per-column generators, check table computation
│   ├── protections.ts         # rare-category merge, label codes, rename
│   ├── errors.ts              # error type that forbids cell values in messages
│   └── spec/                  # types and valibot validators
├── workers/
│   ├── profile.worker.ts      # DuckDB: open, sniff, load, profile
│   ├── profile/               # stats.ts, ids.ts, batchFromHandle.ts (only if the memory spike fails)
│   ├── generate.worker.ts     # spec-only generation and CSV encoding
│   └── netpatch.ts            # fetch and XHR patch that reports to the UI
├── theme/                     # tokens.css, fonts, useTheme (copied from the reference)
├── styles/                    # app.css (copied and adapted)
└── assets/logo/               # WFRC logo (copied)
tests/
├── unit/                      # rng, sampling, classify, mask, datefmt, csv, encoding, spec
├── integration/               # profile SQL on small fixtures; CSV round trip
├── component/                 # stepper, review filters, mask editor, error states
├── e2e/                       # Playwright: flow, network counter, reload, 500 MB
├── fixtures/                  # small committed fixtures only
└── setup.ts
.fixtures/                     # gitignored large fixtures
```

**Structure Decision**: One Vite project (static web app). Pure logic sits in `src/lib` with no
React or DOM so it can be unit-tested and reused by both workers, which keeps Principle VIII cheap
to follow. The two workers follow the privacy boundary: only `profile.worker.ts` ever sees real
data. `.gitignore` already covers `public/duckdb/` and `*.zip`; `.fixtures/` is added when
the scripts land.

## Complexity Tracking

> Deviations from the constitution that are justified for this slice only.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Principle III: no Pages workflow, offline zip or Excel-extension CI test in this slice | The spec scopes them to a separate infrastructure feature so the core flow can be proven first | Building deployment first delays the first working prototype; the app is still static and self-hosted, so privacy is unaffected. Tracked as not-started tasks; required before v1 release |
| Principle IX: folder output via File System Access API deferred | Spec scope: single-file download works everywhere and proves the pipeline | Folder output needs a permission and fallback UI that adds no value to the first slice. Tracked as a not-started task; required before v1 release |
| Newer dependencies than the reference (`@tanstack/react-virtual`, `valibot`, Playwright) | Needed for virtualized lists, spec validation under a strict CSP, and browser-only checks | Hand-rolling a virtual list and validators is riskier; jsdom cannot run WASM workers or measure network |
| Older tool majors kept (Vite 5, Vitest 2) | Constitution asks to mirror the reference tooling | Moving to current majors is planned as its own chore so a migration doesn't hide inside a feature |
