# Implementation Plan: JSON input and output

**Branch**: `007-json-input-output` | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-json-input-output/spec.md`

## Summary

A JSON file becomes a fourth source beside CSV, Excel and Parquet. DuckDB's `json` extension reads it
(spike, Node build of the pinned engine: arrays and one-record-per-line files, byte-order marks, CRLF,
blank lines, pretty-printed arrays and 200,000 records in 63 ms all read; damaged files fail with a
message that names the file and a byte offset and quotes no content). As with `excel` and `parquet`,
the reader is a loadable extension in the browser build, so `fetch-extensions.mjs` downloads `json`
for both builds at build time (it exists on the official host for `wasm_eh` and `wasm_mvp`), the site
serves it, and the offline zip carries it.

The profile worker never lets the engine infer a table from the data. It reads each record as one JSON
value (`read_json_objects`) and asks structure questions only: how many records, which keys in
first-seen order, the JSON type of each key per record (`json_type`), and whether a key exists
(`json_exists`), which separates `null` from missing. It then builds the same all-text `src` table the
other paths use (`json_extract_string` per key: numbers as text, true/false, `NULL` for null and missing,
the empty-text token for `""`), so profiling, review, generation and checks are unchanged. Objects
and lists are loaded as all-NULL and marked unsupported with a reason that names the kind. A key that
mixes kinds loads as text with a warning.

The fake file is written by a small own writer in the generate worker (no engine there, as for xlsx and
Parquet): it takes the rendered cell text the CSV path already produces, converts each cell to the key's
recorded JSON kind (number, text, true or false, `null`, or omitted), and emits an array (with the
recorded indent) or one record per line, with the recorded line ending, trailing newline and byte-order
mark. The spec moves to version 5 with a JSON source and a `json_kind` per column. No new runtime
dependency.

## Technical Context

**Language/Version**: TypeScript 5.9 strict; Node 24 for tooling and CI; Python (`json`, pandas) only to build fixtures and to cross-check read-back

**Primary Dependencies**: existing stack plus nothing new at runtime. Reading is DuckDB's `json` extension, self-hosted like `excel` and `parquet`; writing is our own code.

**Storage**: none (session memory only; the spec JSON is the only artifact)

**Testing**: Vitest (unit for the writer, kind mapping and conversion; integration with DuckDB in Node), Playwright (Chromium, Edge, Firefox, WebKit; offline zip), Python's `json` and DuckDB as independent readers of the fake file

**Target Platform**: browsers, GitHub Pages, and the offline zip

**Project Type**: single-page web app with two workers

**Performance Goals**: the slice 1 targets: a JSON file of about 500 MB once opened profiles and exports within the CSV time targets; page responsive

**Constraints**: no network after load; no value, no text from inside a record and no nested key name stored, shown or returned; deterministic output; engine error text is never shown (fixed messages only)

**Scale/Scope**: one file per run; up to a few hundred keys; warning above 100 MB of expanded data, stop above 1 GB expanded (same rule as Excel and Parquet)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status |
|-----------|--------|
| I. Privacy first | Pass. Only structure is queried (keys, JSON types, existence); the one place values pass through is the load into the in-memory table, as for CSV; engine messages are replaced by fixed ones; a spy test and a planted-marker test prove it; no request is added. |
| II. Minimal derived artifact | Pass, and central. The spec gains key kinds and counts only; no value, no nested key name. |
| III. Client-only static deployment | Pass. The `json` extension is fetched at build time into `public/duckdb-ext/`, served by the site, carried by the offline zip; a CI smoke test proves it loads. |
| IV. Format fidelity | Pass. Keys, order, JSON kinds, null versus missing, indent, line ending and trailing newline are kept. The constitution's fidelity list gains "JSON form and layout" (amendment noted in Complexity Tracking). |
| V. Reproducibility | Pass. Same spec and seed give the same bytes. |
| VI. User control and transparency | Pass. Mixed and unsupported keys say why; the written form is shown on Generate. |
| VII. Brand and accessibility | Pass. Existing components; new notes use the tooltip component and are covered by the axe test. |
| VIII. Test-driven correctness core | Pass. Writer, mapping and conversion are unit tested first; two independent readers check the output. |
| IX. Scale and performance | Pass. Records are written in chunks; measured on a large file. |
| X. Vertical slices | Pass. Array and one-record-per-line forms are each testable alone (US1, US2). |

Dependencies: none added. Re-check after design: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/007-json-input-output/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── spec-file-v5.md       # json source and json_kind on columns
│   └── json-output.md        # what the written file contains and does not
├── checklists/requirements.md
└── tasks.md                  # /speckit-tasks
```

### Source Code (repository root)

```text
src/lib/json/
├── types.ts            # JsonKind, JsonForm, JsonLayout; fixed unsupported reasons and messages
├── detect.ts           # form (array / one record per line) from the first bytes; BOM, line ending, indent, trailing newline from a bounded head and tail
├── kinds.ts            # per-key json_type counts -> JsonKind, null and missing counts, mixed warning
├── convert.ts          # rendered cell text -> JSON token for a key's kind
└── writer.ts           # streaming writer: array or one record per line, layout, BOM
src/lib/spec/types.ts, validate.ts, build.ts, toProfiles.ts   # version 5, json source, json_kind
src/lib/generate/json.ts            # jsonLayoutOf(spec), writeJson(spec, seed, chunkRows, ...)
src/lib/generate/table.ts           # plan handles the json source (missing keys per record)
src/workers/profile/json.ts         # inspectJson (structure only), loadJson (-> all-text src)
src/workers/profile.worker.ts, protocol.ts   # detect by content, load, errors
src/workers/generate.worker.ts      # generateJson path streaming chunks
src/app/session.ts                  # file kind, fakeBlob mime, fake file name keeps .json / .ndjson / .jsonl
src/features/ingest/                # JsonSummary card (keys, kinds, records), size warning
src/features/review/                # unsupported and mixed notes (tooltips); kind shown on the card
src/lib/errors.ts                   # json_* codes with fixed messages
scripts/fetch-extensions.mjs, copy of the list in verify-release.mjs / build-release.mjs   # add "json"
scripts/make-json-fixtures.py       # fixtures with planted markers, every kind, nested, mixed, damaged, forms
tests/
├── unit/{json-detect,json-kinds,json-convert,json-writer,spec-validate-json}.test.ts
├── integration/{json-load,json-privacy,json-readback}.test.ts
├── component/json-ingest.test.tsx
└── e2e/{json-flow,json-privacy}.spec.ts (+ offline-zip session)
```

**Structure Decision**: JSON is a fourth source, so it lives in `src/lib/json/` (pure, tested in Node) with thin adapters in the two workers, mirroring `src/lib/xlsx/` and `src/lib/parquet/`. Reading uses the engine's JSON reader on whole records; writing is our own because only the generate worker has the spec and it must stay engine-free.

## Complexity Tracking

| Choice | Why needed | Simpler alternative rejected because |
|--------|------------|--------------------------------------|
| Own JSON writer | The generate worker has no engine and must never see real data; null versus missing and the recorded layout must be exact | Engine `COPY ... TO json` would pull the engine into the generate worker and cannot omit a key per record or reproduce indent |
| Read records as JSON values and query types, not `read_json_auto` | Auto-detection merges `null` and missing, widens mixed keys silently and can sample only part of the file | The spec requires null versus missing and a warning for mixed keys |
| Constitution Principle IV amendment | The fidelity list names CSV, Excel and Parquet; JSON adds form and layout | Leaving it out would make the list read as complete when it is not (a patch bump of the constitution, in the same commit as the first task) |
