# Implementation Plan: File formats for designed tables

**Branch**: `009-designed-table-formats` | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

## Summary

A design gains an `output` field (csv, xlsx, parquet, json, ndjson). `specFromDesign` builds the matching source (CSV as today;
workbook with one sheet; Parquet with a row-group count; JSON array or lines) and adds the per-column description each format
needs: a number format and date format for the workbook (`cell_format`), a `parquet_type` for Parquet, a `json_kind` for JSON.
The result is an ordinary spec, validated by the existing validator, so the generate worker, the writers and every check work
unchanged. The Design screen gets a "File type" select in Table settings with a tooltip; the Generate screen already shows the
real file type. No new spec version, no new dependency.

## Technical Context

TypeScript, React 19, the existing writers (workbook, Parquet, JSON); Vitest and Playwright; nothing new at runtime.

## Constitution Check

| Principle | Status |
|-----------|--------|
| I. Privacy | Pass. No real data; no request added. |
| II. Minimal artifact | Pass. The spec of a designed table holds only what the person typed, as before. |
| IV. Format fidelity | Pass. Each format gets the types and layout its readers expect. |
| V. Reproducibility | Pass. Same design and seed give the same bytes in every format. |
| VII. Accessibility | Pass. The new select is a labelled control with a tooltip; the a11y suite covers Design. |
| VIII. Tests first | Pass. Unit tests for the builder per format precede the screen change. |

## Project Structure

```text
src/lib/design/{types,defaults,validate,build}.ts      # output field, per-format column fields, source per format
src/features/design/DesignScreen.tsx                   # File type select in Table settings
tests/unit/design-build.test.ts, tests/integration/design-formats.test.ts, tests/component/design-screen.test.tsx, tests/e2e/design-flow.spec.ts
src/app/HelpGuideModal.tsx, README.md                  # CSV-only wording removed
```

## Complexity Tracking

None: no new abstraction, only a field and a mapping per format.
