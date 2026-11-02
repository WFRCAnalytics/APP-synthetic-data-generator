# Implementation Plan: UI polish (Generate and Design)

**Branch**: `010-ui-polish` | **Spec**: [spec.md](spec.md)

## Summary

`formatCheckValue` (a pure function in `src/features/generate/checkFormat.ts`) turns a counts-per-label text into readable pairs; the
check table gets a fixed layout with percentage widths and a Result cell with a tick or a cross. The Design list reuses Review's
dictionary classes (`column-nav*`) with a kind colour on each row and a `describeColumn` line (`src/lib/design/summary.ts`) built from
what the person typed. No new dependency, no change to generation, files or specs.

## Constitution Check

Privacy, minimal artifact, format fidelity and reproducibility are untouched (presentation only). Accessibility (VII) is checked by the
axe suite in both themes. Tests first (VIII): the formatter and the summary line have unit tests.

## Structure

```text
src/features/generate/{checkFormat.ts,GenerateScreen.tsx}   src/lib/design/summary.ts   src/features/design/DesignNav.tsx
src/styles/features.css   tests/unit/{check-format,design-summary}.test.ts
```
