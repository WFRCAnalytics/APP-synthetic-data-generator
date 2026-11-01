# Implementation Plan: Parquet input and output

**Branch**: `005-parquet-input-output` | **Date**: 2026-11-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-parquet-input-output/spec.md`

## Summary

A Parquet file becomes a third source beside CSV and Excel. DuckDB-WASM reads Parquet in its core
(no extension to download; spike: snappy, gzip, zstd and uncompressed all read, and damaged files
fail with a message that quotes nothing). The profile worker asks the engine only for structure:
the column types, `parquet_schema` (physical and logical type per top-level column), the row count
and the row-group count. It never selects `created_by`, key-value metadata or any statistics. The
typed data is converted into the same all-text `src` table the CSV and Excel paths use (dates and
timestamps as ISO text, decimals and 64-bit integers as exact text, nulls as NULL, empty text as the
empty-text token), so profiling, review, generation and checks are unchanged. List, struct and map
columns are loaded as all-NULL and marked unsupported with a reason that names the kind.

The fake file is written by an own streaming writer (research R3): the generate worker works from
the spec alone and must stay free of the 36 MB engine and of real data. The writer emits row groups
of plain-encoded, gzip-compressed column chunks with a footer that names this app, no key-value
metadata and no statistics. It takes the rendered cell text the CSV path already produces and
converts it to each column's recorded type, clamping into the type's range. The spec moves to
version 4 with a Parquet source and one type description per column. No new runtime dependency.

## Technical Context

**Language/Version**: TypeScript 5.9 strict; Node 24 for tooling and CI; Python (pyarrow, pandas) only to build fixtures and to cross-check read-back locally and in CI

**Primary Dependencies**: existing stack plus nothing new at runtime. Parquet reading is built into DuckDB-WASM; writing is our own code (Thrift compact encoding, PLAIN values, RLE levels, `CompressionStream("gzip")`).

**Storage**: none (session memory only; the spec JSON is the only artifact)

**Testing**: Vitest (unit for the writer, type mapping and conversion; integration with DuckDB in Node), Playwright (Chromium, Edge, Firefox, WebKit; offline zip), pyarrow and DuckDB as independent readers of the fake file

**Target Platform**: browsers, GitHub Pages, and the offline zip

**Project Type**: single-page web app with two workers

**Performance Goals**: the slice 1 targets: a 500 MB Parquet file (about the memory of a 500 MB CSV) profiles and exports within the CSV time targets; page responsive

**Constraints**: no network after load; no real value, statistic, key-value text or created-by text stored, shown or returned; deterministic output; values always inside the recorded type's range

**Scale/Scope**: one file per run; up to a few hundred columns; warning above 100 MB of expanded data, stop above 1 GB expanded (same rule as Excel)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status |
|-----------|--------|
| I. Privacy first | Pass. Only structure is queried; footer fields that can hold real values are never selected; a spy test and a planted-marker test prove it; no request is added. |
| II. Minimal derived artifact | Pass, and central. The spec gains type descriptions only; statistics, key-value text and created-by are excluded by rule and by test. |
| III. Client-only static deployment | Pass. No extension and no new runtime file; the offline zip carries it unchanged. |
| IV. Format fidelity | Pass. Names, order, logical types and nullability are kept; this is the main reason for the slice. |
| V. Reproducibility | Pass. Same spec and seed give the same bytes (no timestamps in the file; the footer's created-by is a fixed string). |
| VI. User control and transparency | Pass. Unsupported columns say why; the compression used is shown on Generate. |
| VII. Brand and accessibility | Pass. Existing components; the new notes are covered by the axe test. |
| VIII. Test-driven correctness core | Pass. Writer, mapping and conversion are unit tested first; two independent readers check the output. |
| IX. Scale and performance | Pass. Row groups bound memory; measured on a large file. |
| X. Vertical slices | Pass. Each story is testable alone. |

Dependencies: none added. Re-check after design: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/005-parquet-input-output/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── spec-file-v4.md        # parquet source and parquet_type on columns
│   └── parquet-output.md      # what the written file contains and does not
├── checklists/requirements.md
└── tasks.md                   # /speckit-tasks
```

### Source Code (repository root)

```text
src/lib/parquet/
├── types.ts            # ParquetType description, parse/format, ranges, describe for the UI
├── schema.ts           # DuckDB type + parquet_schema row -> ParquetType; unsupported reasons
├── thrift.ts           # Thrift compact writer (the few structs Parquet needs)
├── encode.ts           # PLAIN values, RLE definition levels, bit-packed booleans, per type
├── writer.ts           # streaming file writer: row groups, footer, gzip pages
└── convert.ts          # rendered cell text -> typed value (clamped), counts narrowed values
src/lib/spec/types.ts, validate.ts, build.ts, toProfiles.ts   # version 4, parquet source, parquet_type
src/lib/generate/parquet.ts         # parquetLayoutOf(spec), writeParquet(spec, seed, chunkRows, ...)
src/lib/generate/table.ts           # dialect/plan handle the parquet source
src/workers/profile/parquet.ts      # inspectParquet (structure only), loadParquet (typed -> all-text src)
src/workers/profile.worker.ts, protocol.ts   # detect by content (PAR1), load, errors
src/workers/generate.worker.ts      # generateParquet path streaming chunks
src/app/session.ts                  # file kind, fakeBlob mime, fake file name .parquet
src/features/ingest/                # ParquetSummary card (names, types, row groups), size warning
src/features/review/                # unsupported reasons for nested columns; type shown on the card
src/lib/errors.ts                   # parquet_* codes with fixed messages
scripts/make-parquet-fixtures.py    # fixtures with planted markers, all codecs, damaged files
tests/
├── unit/{parquet-types,parquet-schema,parquet-thrift,parquet-encode,parquet-writer,parquet-convert,spec-validate-parquet}.test.ts
├── integration/{parquet-load,parquet-privacy,parquet-readback}.test.ts
├── component/parquet-ingest.test.tsx
└── e2e/{parquet-flow,parquet-privacy}.spec.ts (+ offline-zip session)
```

**Structure Decision**: Parquet is a third source, so it lives in `src/lib/parquet/` (pure, tested in Node) with thin adapters in the two workers, mirroring `src/lib/xlsx/`. Reading uses the engine's built-in reader; writing is our own because only the generate worker has the spec and it must stay engine-free.

## Complexity Tracking

| Choice | Why needed | Simpler alternative rejected because |
|--------|------------|--------------------------------------|
| Own Parquet writer | The generate worker has no engine (36 MB wasm) and must never see real data; the footer must carry nothing from the real file | DuckDB `COPY ... TO parquet` would pull the engine into the generate worker, double memory for big tables and risk statistics and metadata being copied |
| Plain encoding with gzip, no dictionary | Smallest correct writer, readable by every common reader | Dictionary and delta encodings add code and no fidelity; file size is not a requirement |
