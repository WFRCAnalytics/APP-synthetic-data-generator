# Implementation Plan: Excel Input and Output

**Branch**: `003-excel-input-output` | **Date**: 2026-10-31 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-excel-input-output/spec.md`

## Summary

An .xlsx workbook becomes a source like a CSV file. A small reader of the workbook's own
packaging (`workbook.xml`, `styles.xml`, and the head of one sheet) lists sheet names and
visibility, the date system, the number format of every column and a suggested number of rows to
skip, without reading any cell value into the page. The data itself is read by the DuckDB Excel
extension, served from the site and loaded under the strict content policy (spike result:
loads, zero violations, zero outside requests). The sheet is converted to the same all-text table
the CSV path uses, so profiling, review, generation and the check table are unchanged. The fake
workbook is written by an own streaming writer (zip with data descriptors, deflate from the
browser's `CompressionStream`), because DuckDB's writer cannot set number formats or tell blank
cells from empty text. SheetJS is not needed. The spec moves to version 3 and records the sheet
source and one cell format per column.

## Technical Context

**Language/Version**: TypeScript 5.9 strict, Node 24 for tooling and CI

**Primary Dependencies**: existing stack plus nothing new at runtime. The Excel extension is a build-time download (files, not a package). No SheetJS.

**Storage**: none (session memory only; spec JSON is the only artifact)

**Testing**: Vitest (unit; integration with DuckDB in Node), Playwright (Chromium, Edge, Firefox, WebKit), Python (openpyxl, pandas, xlsxwriter) only to build fixtures and to cross-check read-back locally

**Target Platform**: browsers, static hosting on GitHub Pages

**Project Type**: single-page web app with two workers

**Performance Goals**: slice 1 targets scaled for the format: a 50 MB workbook (about 500 MB of sheet data once expanded) profiles and exports in under 5 minutes each

**Constraints**: no network after load; extension files served from the site; no real cell value, formula or other-sheet content stored, shown or returned; deterministic output; memory estimate before loading

**Scale/Scope**: one sheet per run; up to a few hundred columns; up to about 1 GB of expanded sheet data (warning above 100 MB, stop above the measured limit)

## Constitution Check

| Principle | Check | Result |
|---|---|---|
| I Privacy first | Metadata reader returns names, flags and format codes only; the extension is same-origin; other sheets are never read; leak tests cover other sheets, titles and comments (FR-019) | Pass |
| II Minimal derived artifact | Spec holds sheet name, range, rows skipped, header, date system, format codes per column; no value, text or formula | Pass |
| III Client-only static deployment | Extension files are fetched at build time into `public/duckdb-ext/` (gitignored), derived from the pinned engine version; a smoke test runs before every deploy | Pass |
| IV Format fidelity | Sheet name, header offset, column order, cell types and number formats are kept (FR-011) | Pass |
| V Reproducibility | Same generators, seeds and check table; cell values are a pure function of the spec and seed | Pass |
| VI User control | The dialog lets the user change sheet, rows skipped, header and range before profiling | Pass |
| VII Brand and accessibility | Reuses components and tokens; axe checks extended to the dialog | Pass |
| VIII Test-driven core | The metadata reader, the cell converters and the writer are pure TypeScript with unit tests first | Pass |
| IX Scale | Streaming writer; size warning from the zip directory before loading; expanded-size stop | Pass |
| X Progress tracking | tasks.md for this feature; slice 1 deferred T101, T104, T105 and T106 are superseded | Pass |

No violations; Complexity Tracking is empty. Re-checked after design: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/003-excel-input-output/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── spec-file-v3.md
└── tasks.md             # created by /speckit-tasks
```

### Source Code (repository root)

```text
scripts/
├── fetch-extensions.mjs       # NEW: derive engine version, download extension files, record checksums
└── make-xlsx-fixtures.py      # NEW: builds tests/fixtures/xlsx/*.xlsx (xlsxwriter, openpyxl)

src/
├── lib/
│   ├── xlsx/                  # NEW, pure and browser-safe
│   │   ├── zip.ts             #   read a zip's central directory and entries; write a streaming zip
│   │   ├── metadata.ts        #   workbook.xml, styles.xml, sheet head: sheets, date system, formats, hints
│   │   ├── formats.ts         #   number format codes: classify (date, time, number, text), decimals, thousands
│   │   ├── serial.ts          #   Excel serial numbers and ISO dates, both date systems
│   │   ├── writer.ts          #   streaming .xlsx writer: styles, rows, cell types
│   │   └── names.ts           #   column letters, ranges, sheet name rules
│   ├── spec/                  # types.ts, validate.ts, build.ts, toProfiles.ts: source "xlsx", cell_format, version 3
│   ├── generate/              # table.ts, render.ts: xlsx output path; checks unchanged
│   └── duckdb/engine.ts       # load the Excel extension from the site
├── workers/
│   ├── profile/xlsx.ts        # NEW: inspect, load a sheet into the all-text table
│   ├── profile.worker.ts      # inspectWorkbook and loadSheet messages
│   ├── generate.worker.ts     # xlsx chunks
│   └── protocol.ts
└── features/ingest/           # WorkbookDialog.tsx (NEW), IngestScreen.tsx (accept .xlsx), SizeWarning (xlsx)

tests/
├── unit/                      # zip, metadata, formats, serial, writer, names, spec v3
├── integration/               # xlsx-profile.test.ts, xlsx-roundtrip.test.ts, xlsx-privacy.test.ts
├── component/                 # workbook dialog
├── e2e/                       # excel-extension.spec.ts (CI smoke), excel-flow.spec.ts, leak and a11y extended
└── fixtures/xlsx/             # quirks.xlsx and others, small and committed
```

**Structure Decision**: extend the slice 1 and 2 layout. Everything that understands the xlsx
package lives in `src/lib/xlsx/` as pure code, testable in Node. The only browser-specific pieces
are the extension loading (engine) and the worker messages.

## Complexity Tracking

No constitution violations to justify.
