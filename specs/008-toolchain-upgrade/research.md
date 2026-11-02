# Research: Toolchain upgrade

## R1: Baseline (2026-11-02, before any group)

- Node 26.12.1 locally (CI uses 24); tests: 1,883 passed, 1 skipped (Vitest 2.1.9, jsdom 24.1.3).
- Production assets (`dist/assets`): 1,884,615 bytes in total; gzip of the three scripts: index 113,307, generate worker 187,204, profile worker 69,853.
- Versions: Vite 5.4.21, `@vitejs/plugin-react` 4.7.0, Vitest 2.1.9, jsdom 24.1.3, ESLint 8.57.1 with typescript-eslint 7.18.0, TypeScript 5.9.3, React 18.3.1, `@types/node` 20.19.43. DuckDB-WASM stays at `1.33.1-dev57.0`.
- Golden hashes: `tests/unit/golden-output.test.ts` pins sha-256 of the bytes for CSV, JSON (array and lines), uncompressed Parquet and a workbook sheet.
