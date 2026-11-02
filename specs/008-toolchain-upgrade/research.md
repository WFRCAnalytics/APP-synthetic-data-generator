# Research: Toolchain upgrade

## R1: Baseline (2026-11-02, before any group)

- Node 26.12.1 locally (CI uses 24); tests: 1,883 passed, 1 skipped (Vitest 2.1.9, jsdom 24.1.3).
- Production assets (`dist/assets`): 1,884,615 bytes in total; gzip of the three scripts: index 113,307, generate worker 187,204, profile worker 69,853.
- Versions: Vite 5.4.21, `@vitejs/plugin-react` 4.7.0, Vitest 2.1.9, jsdom 24.1.3, ESLint 8.57.1 with typescript-eslint 7.18.0, TypeScript 5.9.3, React 18.3.1, `@types/node` 20.19.43. DuckDB-WASM stays at `1.33.1-dev57.0`.
- Golden hashes: `tests/unit/golden-output.test.ts` pins sha-256 of the bytes for CSV, JSON (array and lines), uncompressed Parquet and a workbook sheet.

## R2: Group A (Vite 8, `@vitejs/plugin-react` 6, Vitest 5, jsdom 30, `@types/node` 24, react-virtual 3.14.25, lucide-react 1.66)

- npm's strict peer resolver refuses the set (a stale peer constraint it will not name), so the tree was installed with
  `--legacy-peer-deps`; `npm ls` shows no invalid or missing package, and a clean `npm ci` from the lock file works.
  `@testing-library/dom`, which Testing Library 16 needs as a peer, is now a dev dependency of its own.
- `vite.config.ts`: `build.rollupOptions` became `rolldownOptions`; `./vite.csp.ts` is imported with its extension.
- Tests: all 1,883 pass. Two whole-table round trips (the type zoo) took 6 to 8 s beside the other files, over the 5 s
  default, so `testTimeout` is 30 s; no test was changed.
- Two end-to-end checks that were out of date from earlier slices (spec version 5; the file name now shown on the page after
  choosing a file) were fixed, and they are not caused by the tools.
- Build: 280 ms (was 2.2 s). Production assets 1,880,168 bytes (was 1,884,615); gzip index 110,575, generate worker
  186,140, profile worker 68,332 (were 113,307, 187,204, 69,853). No source maps.
- Whole Chromium end-to-end suite: 103 passed; offline zip and guard: 15 passed; golden bytes unchanged.

## R3: Group B (ESLint 10, typescript-eslint 8, react-hooks 7, react-refresh 0.5, eslint-config-prettier 10)

- `.eslintrc.cjs` and `.eslintignore` are replaced by `eslint.config.js` (flat config) with the same rules: the recommended
  JavaScript and TypeScript sets, the two classic hooks rules, the fast-refresh warning, Prettier last, and the faker import
  ban with its exceptions. The newer compiler-based rules of `eslint-plugin-react-hooks` 7 are left out of this check.
- ESLint 10's recommended set adds `no-useless-assignment`; it found three assignments that were never read (an unused
  initial value in `serial.ts` and `profiler.ts`, and one in a test). Each was removed; behaviour is unchanged. Lint: 0 errors,
  the same 2 fast-refresh warnings as before. Tests: 1,883 pass.
- `typescript-eslint` 8 supports TypeScript up to below 6.1, which bears on group C (see R4).

## R4: Group C (TypeScript 6.0.3, not 7)

- TypeScript 7 (the native compiler) is not used: `typescript-eslint` 8.72 supports TypeScript below 6.1 and reads the
  compiler's JavaScript API, which the native version does not offer, so linting would break. The spec's assumption covers
  this: a tool whose newest major does not work with the rest stays on its last working version, and this is recorded.
  TypeScript 6.0.3 is the newest version the linter supports. To move to 7, wait for `typescript-eslint` to support it.
- `tsc --noEmit` shows no new error; lint 0 errors; tests 1,883 pass; the build works.
