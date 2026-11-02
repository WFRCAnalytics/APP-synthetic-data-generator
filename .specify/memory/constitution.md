<!--
Sync Impact Report
Version change: (blank template) → 1.0.0
Modified principles: none (initial ratification)
Added principles: I. Privacy First; II. Minimal Derived Artifact; III. Client-Only Static
  Deployment; IV. Format Fidelity; V. Reproducibility and Determinism; VI. User Control and
  Transparency; VII. Brand Consistency and Accessibility; VIII. Test-Driven Correctness Core;
  IX. Scale and Performance; X. Progress Tracking
Added sections: Technology and Delivery Constraints; Development Workflow and Quality Gates;
  Governance
Removed sections: none
Templates requiring updates: none modified here (plan/spec/tasks templates read this file at
  runtime; the plan template's "Constitution Check" gate now evaluates Principles I-X)
Deferred TODOs: none
-->
# WFRC Synthetic Data Generator Constitution

## Core Principles

### I. Privacy First: Data Never Leaves the Device (NON-NEGOTIABLE)

User-uploaded data, and anything derived from it, MUST be processed only inside the browser
tab. The app MUST NOT upload data, call a backend, send analytics or telemetry, or set
cookies or tracking identifiers.

- After the page loads, the only permitted network requests are same-origin static assets,
  including the self-hosted DuckDB-WASM binaries and extension files. Runtime CDN loads are
  prohibited.
- The UI MUST show a network-request counter that wraps `fetch` and the DuckDB worker
  loading, with same-origin and cross-origin requests counted separately.
- Real rows MUST NEVER be displayed in the UI. Dialogs that load a file (including the Excel
  dialog) MAY show structural metadata such as worksheet names, row and column counts, and
  column names, but not cell data.
- Closing or reloading the page MUST clear all real data from memory.

Rationale: the tool exists so AI coding agents never see real respondent data. A single leak
defeats its purpose, and the no-network claim must be verifiable by the user.

### II. Minimal Derived Artifact

The spec JSON is the only artifact derived from real data. It MUST stay small and readable
end to end.

- Real values MAY appear only where SPEC.md's privacy model allows: category labels, exact
  min and max, and sentinel codes.
- The spec MUST NOT store lists of IDs, free text, personal identifiers, or coordinates
  (coordinates are limited to a bounding box and precision).
- Survey IDs MUST be described by an editable pattern mask, optional min and max, and a
  repeat structure.
- Personal identifiers (names, emails, phones, addresses) MUST be generated with
  `@faker-js/faker` (locale `en_US` for v1) and MUST NOT use real values.

Rationale: a spec the user can audit in full is the only honest answer to "what was taken
from my data?".

### III. Client-Only Static Deployment

The app MUST be a static site with no backend, database, or accounts.

- It MUST be hosted on GitHub Pages through a GitHub Actions workflow. Build, lint, and tests
  MUST pass before deploy, and build output MUST NOT be committed to `main`.
- Each GitHub Release MUST attach an offline zip that bundles the app, the DuckDB-WASM
  binaries, and the extension files.
- The DuckDB-WASM version MUST be pinned in `package.json`. A build script MUST derive the
  matching engine version and fetch the matching extension files (such as `excel`) into
  `public/duckdb/`, which is gitignored.
- CI MUST smoke-test that the bundled Excel extension loads a small xlsx file.
- SheetJS MAY be used only as a fallback if DuckDB's Excel reader proves insufficient.

Rationale: a static, self-hosted bundle keeps the privacy claim checkable and lets the tool
run offline on locked-down machines.

### IV. Format Fidelity

Exported files MUST keep the input's format and parse-level details so that code written on
fake data runs unchanged on real data. This covers:

- Column names and order, NA tokens, sentinel codes, decimal places, leading zeros, and
  date and time string formats.
- CSV delimiter, quote style, encoding, line endings, header presence, and BOM.
- Excel sheet name and header row offset.
- Parquet dtypes.
- JSON form (array or one record per line), key order, null versus missing keys, indent, line ending
  and trailing newline.

Rationale: agents break on parsing details far more often than on statistics.

### V. Reproducibility and Determinism

Generation MUST use a seeded random generator with per-column sub-seeds derived from the
global seed and the column name. Changing one column's settings MUST NOT change any other
column's output.

- Exact summaries (category counts, NA and sentinel counts, exact min and max) MUST be hit
  exactly.
- An in-app check table MUST verify every summary against its target after generation.

Rationale: reproducible output lets users regenerate, share a seed, and trust the result.

### VI. User Control and Transparency

The user MUST be able to review and override every detected decision before generation:
type, sentinels, numeric mode, ID mask, exclusions, and optional protections.

- Optional protections (rare-category merging, label replacement, column renaming) MUST be
  off by default.
- Uncertain detections (possible identifiers, possible sentinels, columns near the
  categorical threshold) MUST be flagged for attention.

Rationale: detection is heuristic, and survey analysts know their data's codebook better than
any profiler.

### VII. Brand Consistency and Accessibility

The UI MUST reuse the theming of the WFRC Scoresheet reference app
(`APP-Project-Scoresheet`): `theme/tokens.css`, the base styles in `app.css`, and the WFRC
logo and header. Styling MUST use those brand tokens only, with no invented colors.

- The UI MUST be keyboard operable, show a visible focus ring, and meet sufficient color
  contrast.

Rationale: WFRC tools should look and behave consistently, and be usable by everyone.

### VIII. Test-Driven Correctness Core

The correctness core MUST be pure TypeScript with Vitest unit tests. That includes the
generators, the samplers (beta via gamma draws, percentile interpolation, repeat structure,
ID mask), seeding, type detection, and spec validation.

- Integration tests MUST cover parse and export round trips.
- Component tests MUST cover the main user flows (ingest, review, generate).
- A change to the correctness core MUST include or update tests in the same PR.

Rationale: the tool's value rests on statistical and format guarantees that regress silently
without tests.

### IX. Scale and Performance

The app MUST be designed for tables up to about 500 MB and 100 to 120 or more columns.

- The browser `File` MUST be handed to DuckDB without a full in-memory copy. Profiling MUST
  use SQL, and generation and export MUST be chunked or streamed.
- Long operations MUST show progress. Large inputs, especially xlsx, MUST trigger a size
  warning.
- The Review screen MUST support many columns through a virtualized, filterable, searchable
  list.
- Latest Chrome and Edge MUST be fully supported, including folder output through the File
  System Access API. Firefox and Safari MUST work with single-file download, and behavior
  SHOULD stay consistent across browsers as far as practical.

Rationale: real household survey tables are large and wide, and an unresponsive tab gets
abandoned.

### X. Progress Tracking and Vertical Slices

The spec-kit `tasks.md` for each feature is the single source of truth for remaining work.

- `/speckit-converge` MUST be run to re-sync tasks with the code at the end of each slice.
- Work MUST be delivered as vertical slices. The first slice is CSV in, profile and review,
  spec JSON, generate, and CSV out, covering categorical, numeric, date, and ID columns.
- Any deferred or partial spec item MUST appear as an explicit task, never as an undocumented
  gap.

Rationale: the maintainers should never have to remember what is left.

## Technology and Delivery Constraints

- **Stack**: Vite, React 18, and TypeScript; Vitest; ESLint and Prettier; DuckDB-WASM;
  `@faker-js/faker`; a small seeded PRNG (sfc32); Node.js 20 or newer. Tooling and conventions
  mirror the Scoresheet repo.
- **Charts**: Column-card sparklines MUST be hand-written SVG. A charting library (Recharts
  first) MAY be added only when a larger chart is justified in a plan.
- **Dependencies**: Every new runtime dependency MUST be justified in the plan, MUST NOT make
  network requests at runtime, and MUST NOT include telemetry.
- **License**: MIT.
- **Source document**: `SPEC.md` is the design source for feature specs. If it and this
  constitution conflict, this constitution wins.

## Development Workflow and Quality Gates

- Features follow the spec-kit flow: `/speckit-specify`, `/speckit-plan`, `/speckit-tasks`,
  `/speckit-implement`, then `/speckit-converge`.
- Every plan MUST pass a Constitution Check against Principles I to X before design starts
  and again after design.
- CI MUST run lint, type-check, and tests, and MUST build the site. A deploy MUST NOT proceed
  if any of these fail.
- Changes to anything that handles real data (ingest, profiling, spec export) MUST be
  reviewed against Principles I and II, and the review MUST confirm that no new network
  request or stored real value is introduced.
- Commits MUST be small and focused. Pull request descriptions MUST state which principles
  the change touches.

## Governance

This constitution supersedes other project practices. Amendments are made by pull request.
Each amendment MUST state the rationale, update the Sync Impact Report, and bump the version.

- **Versioning**: semantic. MAJOR for a removed or redefined principle; MINOR for a new
  principle or materially expanded guidance; PATCH for clarifications and wording.
- **Privacy principles**: Principles I and II MAY be relaxed only with explicit maintainer
  approval recorded in the pull request.
- **Compliance**: every pull request and plan review MUST verify compliance. Any justified
  deviation MUST be recorded in the plan's complexity-tracking table.

**Version**: 1.0.1 | **Ratified**: 2026-10-30 | **Last Amended**: 2026-11-02
