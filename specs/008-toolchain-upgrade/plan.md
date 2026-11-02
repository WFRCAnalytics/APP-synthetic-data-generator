# Implementation Plan: Toolchain upgrade

**Branch**: `008-toolchain-upgrade` | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

## Summary

Move the build, test, lint, type and UI tools to their current majors in four groups, each verified and committed alone:
(A) Vite 8 with `@vitejs/plugin-react` 6, Vitest 5, jsdom 30, `@types/node` and the patch updates (`@tanstack/react-virtual`,
`lucide-react`); (B) ESLint 10 with typescript-eslint 8, `eslint-plugin-react-hooks` 7, `eslint-plugin-react-refresh` and
`eslint-config-prettier` 10, which needs the flat config format; (C) TypeScript 7; (D) React 19 with its types and
`@testing-library` as needed, and `@testing-library/jest-dom` 7. Before anything moves, golden hashes of the bytes written for
a fixed spec and seed in each format are committed as a test, so "same bytes" (SC-002) is checked at every step. DuckDB-WASM
stays pinned at `1.33.1-dev57.0`; the extension script still derives its files from it.

## Technical Context

**Language/Version**: TypeScript (5.9 now, 7 after group C); Node 24 in CI and for tooling; `engines.node` raised to what the tools need

**Primary Dependencies**: as in `package.json`; DuckDB-WASM unchanged

**Testing**: the existing Vitest suites (about 1,880 tests), Playwright in Chromium, Edge, Firefox and WebKit, the offline zip, and a new golden-bytes test

**Constraints**: nothing the analyst sees or receives changes; no test deleted or weakened; bundle no more than 10% larger

## Constitution Check

| Principle | Status |
|-----------|--------|
| I. Privacy first | Pass. No request or storage added; the privacy and content-policy tests run unchanged at every group. |
| II. Minimal derived artifact | Pass. The spec format and version do not change. |
| III. Client-only static deployment | Pass. The workflow keeps its steps; the pinned engine and its extension check stay. |
| IV. Format fidelity | Pass, and proved by the golden bytes for CSV, Excel, Parquet and JSON. |
| V. Reproducibility | Pass, same evidence. |
| VII. Brand and accessibility | Pass. The a11y suite runs after the UI library group. |
| VIII. Test-driven correctness core | Pass. The golden test is written first. |
| X. Vertical slices | Pass. Each group is a checkable commit. |

## Project Structure

```text
specs/008-toolchain-upgrade/{spec.md,plan.md,tasks.md,checklists/requirements.md}
tests/unit/golden-output.test.ts   # new: sha-256 of the bytes made for a fixed spec and seed, per format
package.json, package-lock.json, vite.config.ts, eslint.config.js (replaces .eslintrc.cjs), tsconfig.json, .github/workflows/*.yml
```

## Complexity Tracking

| Choice | Why needed | Simpler alternative rejected because |
|--------|------------|--------------------------------------|
| Golden hashes in a test | The only way to prove "the same bytes" across tool changes | Eyeballing outputs would miss a one-byte change in a writer |
| Four groups | A failure points at one group | One big upgrade hides the cause |
