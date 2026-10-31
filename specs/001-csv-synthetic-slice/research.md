# Research: CSV Synthetic Data Slice

**Feature**: 001-csv-synthetic-slice | **Date**: 2026-10-30

Each entry gives the decision, why, and what else was weighed. Items marked **VERIFY** rest on a
behavior of DuckDB-WASM or the browser that must be proven by a prototype task before the
dependent work starts; each has a named fallback.

## R1. Reading a 500 MB CSV without copying it into JS memory

- **Decision**: Hand the browser `File` straight to DuckDB-WASM with `registerFileHandle(...,
  BROWSER_FILEREADER)`, then `CREATE TABLE src AS SELECT * FROM read_csv(..., all_varchar=true)`
  in an in-memory database. Detect settings first with `sniff_csv` on the same handle.
- **Why**: `all_varchar` keeps the raw text of every cell (leading zeros, NA tokens, date strings,
  thousands separators), which Principle IV needs. Types are inferred afterward with `TRY_CAST`
  in SQL, so nothing is lost by early parsing. Loading once into a table avoids re-parsing 500 MB
  for each of ~120 columns of statistics.
- **Alternatives**: Read the file in JS and parse it ourselves (copies the file into memory, slow);
  query the CSV directly for every statistic (re-parses per query); persistent OPFS database
  (survives reload, which violates the "reload clears data" rule).
- **VERIFY**: A 500 MB, 120-column table fits in the WASM memory limit (32-bit, at most 4 GB) as an
  all-varchar table. **Fallback**: profile in column batches straight from the CSV handle, and warn
  above a size threshold.

## R2. Encodings (UTF-8, UTF-16 LE/BE, Windows-1252 / Latin-1)

- **Decision**: Detect in TypeScript from the first 1 MB (BOM check, then UTF-8 validity, then
  Windows-1252 as the fallback). Pass the encoding to `read_csv`.
- **Why**: Detection is cheap and testable as pure code. Export writes the same encoding with small
  hand-written encoders (UTF-16 is trivial; Windows-1252 needs a 32-entry table for 0x80-0x9F).
- **Alternatives**: A detection library (extra dependency, heuristic, no better on this narrow set).
- **VERIFY**: DuckDB-WASM's `read_csv` accepts `utf-16` and `latin-1` in the pinned version.
  **Fallback**: stream-transcode with `TextDecoderStream` into a virtual UTF-8 file registered with
  DuckDB, which costs one extra pass but no persistent storage.

## R3. Profiling in SQL, with progress

- **Decision**: Run statistics in batches of about 20 columns per query, report progress after each
  batch, and keep all results as small summary objects on the main thread. Per column: row count,
  NA-token candidates (top frequent values matched against a known token list), distinct count
  (exact up to a cap), `TRY_CAST` success counts for integer, float, and each candidate date
  pattern, min, max, mean, standard deviation, 101 quantiles, a 20-bin histogram, value counts when
  distinct <= threshold, and the ID repeat structure (`count(*) GROUP BY` the group size).
- **Why**: Batching keeps each query short so the page and progress bar stay alive, and the worker
  keeps the UI thread free.
- **Alternatives**: One query for everything (no progress, giant plan); per-column queries (120x
  scans).
- **VERIFY**: 120 columns profile in under 5 minutes on a 500 MB file (SC-001).

## R4. ID pattern inference (no value lists)

- **Decision**: Compute the per-position class pattern in SQL by collapsing letters to `A` and
  digits to `9` (`regexp_replace`), group by that pattern (few rows), and take the dominant
  pattern. Detect fixed literals by testing whether a position has exactly one distinct character.
  Numeric IDs also record min, max, and zero-padding width.
- **Why**: It uses only aggregates, so no ID value ever reaches the browser's JS heap, the spec, or
  the UI. A 50,000-ID table produces a handful of pattern rows.
- **Alternatives**: Pull distinct IDs into JS and infer there (moves real values into memory that
  could leak into logs or errors).

## R5. Generating without materializing the table: keyed permutations

- **Decision**: Generate every value as a pure function of `(seed, column name, row index)`:
  - A keyed bijection over `[0, n)` (a Feistel network with cycle-walking) assigns each row a rank.
  - NA and sentinel counts take the first ranks, so exact counts land at random rows.
  - Categorical labels come from cumulative counts and a binary search on the rank, so the exact
    multiset is hit with no shuffle buffer.
  - Numeric values use a counter-based random draw per row; the exact min and max are placed at the
    rows whose ranks are the two reserved values.
  - IDs map group index to mask value through a second keyed bijection over the mask's capacity.
- **Why**: Memory is O(columns), not O(rows x columns), so a table of about 1 million rows x 120
  columns streams out in chunks. Chunk size does not change output, which makes "same seed, same
  file" (SC-003) and "changing one column changes nothing else" (FR-021) hold by construction.
- **Alternatives**: Materialize every column and shuffle (hundreds of MB to over 1 GB of arrays);
  a seeded sequential generator (output depends on chunk boundaries).
- **Edge**: Mask capacity can exceed 2^53, so the ID bijection uses `BigInt` only when needed.

## R6. Exact mean and standard deviation after rounding (FR-027)

- **Decision**: Two deterministic passes. Pass 1 regenerates the column and accumulates sum and
  sum of squares; pass 2 applies an affine rescale, rounds, then clips to the real min and max.
  The two rows reserved for the exact min and max are left out of the fit and re-pinned to the exact
  values after rescaling, so SC-002 still holds. Residual mean and sd error after rounding is
  reported in the check table rather than hidden.
- **Why**: Regeneration is free because generation is a pure function (R5).
- **Alternatives**: Store the column (memory cost); skip the step (the spec makes it optional but
  required to exist).

## R7. Beta fit and percentile interpolation

- **Decision**: Hand-written samplers, as SPEC.md states. Beta draws use two gamma draws
  (Marsaglia-Tsang). If the fitted `alpha` or `beta` is not positive (variance too large or too
  small for the bounds, or `sd = 0`), fall back to uniform and flag the column. "Match shape"
  interpolates the stored 101 quantiles.
- **Why**: Keeps the bundle small and the behavior testable with fixed seeds.

## R8. Date, datetime and time handling

- **Decision**: Support a fixed set of pattern directives (`%Y %y %m %d %H %I %M %S %p %b %B %j`
  and literal text) in one shared table used by both the SQL side (translated to DuckDB
  `strptime`) and the TypeScript formatter. Candidate patterns are tried in order; the user can type
  a pattern, and a live count shows how many non-NA values parse. Time zones are out of scope; a
  value with an offset marks the column as unsupported.
- **Why**: One directive table prevents the two sides from disagreeing, which would break format
  fidelity. A closed set also keeps the typed-pattern box safe.

## R9. Network guarantee (Principle I)

- **Decision**: Layer three controls:
  1. A `<meta http-equiv="Content-Security-Policy">` with `default-src 'self'`, `connect-src
     'self'`, `worker-src 'self' blob:`, `script-src 'self' 'wasm-unsafe-eval'`, which makes the
     browser block cross-origin requests.
  2. A `PerformanceObserver` plus a wrapped `fetch` on the main thread.
  3. A wrapper script for the DuckDB worker that patches `fetch` and `XMLHttpRequest` and posts
     counts back, since worker requests are invisible to the main thread.

  The counter shows same-origin, cross-origin, and blocked (from `securitypolicyviolation`).
- **Why**: GitHub Pages cannot set headers, but a meta CSP still enforces `connect-src`. The
  counter then shows an enforced fact, not a hope.
- **Dev server**: Vite's React plugin injects an inline refresh script in development, which the strict
  `script-src 'self'` would block. Apply the strict policy in build and preview only, use a
  dev-safe variant through `transformIndexHtml`, and run the browser tests against `vite preview`.
- **VERIFY**: DuckDB-WASM instantiates under this CSP. **Fallback**: add the narrowest extra source
  that works and document it in this file.

## R10. DuckDB binaries: self-hosting needs no download in this slice

- **Decision**: Pin `@duckdb/duckdb-wasm` exactly in `package.json`. A script copies the `.wasm`
  and worker files from `node_modules` into `public/duckdb/` before dev and build.
- **Why**: The binaries ship inside the npm package, so there is no network step. Extension
  downloads (the Excel extension) belong to the later Excel feature, where the matching-version
  fetch script and CI smoke test from the constitution apply.
- **Note**: `npm` currently lists `1.33.1-dev57.0` as `latest` and `1.33.1-dev110.0` as `next`, so
  an exact pin matters.

## R11. Tooling versions

- **Decision**: React 18.3, TypeScript 5.x, Vite 5.4, Vitest 2, ESLint 8 and Prettier 3, matching
  the Scoresheet repo. Plan a separate chore to move the whole stack forward together.
- **Why**: The constitution says to mirror the reference tooling, which keeps one set of patterns
  for the team. Current majors exist (React 19, Vite 8, Vitest 5, TypeScript 7), but upgrading in
  this slice would mix a migration into a feature.
- **Alternative**: Start on current majors. Rejected for this slice only; revisit in the chore.

## R12. New dependencies beyond the reference app

| Dependency | Use | Why not avoid it |
|---|---|---|
| `@duckdb/duckdb-wasm` | Read and profile CSV | Required by the constitution and SPEC.md |
| `@tanstack/react-virtual` | Virtualized column list | Principle IX needs 120+ cards without lag |
| `valibot` | Validate loaded spec files | Small, makes no `eval`-style calls (fine under the CSP); hand-rolled validation is error-prone |
| `@playwright/test` (dev) | Browser tests: file input, network counter, 500 MB run | jsdom cannot run WASM workers or measure network or memory |
| `lucide-react`, `jszip` | Not needed in this slice | Skipped; add when a feature needs them |

No runtime dependency makes network requests or includes telemetry.

## R13. Test strategy

- **Unit (Vitest)**: RNG and sub-seeds, Feistel bijection (full coverage on small domains), sampler
  moments, mask inference and capacity, date directives, type classifier, spec validation, CSV
  writer quoting.
- **Integration (Vitest, Node)**: profiling SQL through DuckDB-WASM's Node bindings against small
  fixtures; CSV round trip (write fake, parse with the same code as real).
- **Component (React Testing Library)**: stepper, review filters, ID mask editor, error states.
- **Browser (Playwright)**: full flow with a generated 500 MB fixture (not committed), network
  counter equals zero cross-origin, reload clears state.
- **Privacy tests**: a test scans a saved spec for any fixture ID or free-text value.

## R14. Export delivery

- **Decision**: Build the fake CSV as chunks of bytes collected into a `Blob` and download it with an
  object URL. The browser can back large Blobs with disk, but this is not guaranteed.
- **Why**: Works in every browser. A streamed save-file picker (Chrome and Edge) and folder output are
  deferred, so they are recorded as tasks.
- **VERIFY**: A 500 MB output downloads in Chrome and Edge without running out of memory.
  **Fallback**: use `showSaveFilePicker` streaming where available.

## Open items

None blocking. The VERIFY items above become the first prototype tasks, ahead of the work that
depends on them.

## R15. Brand fonts are self-hosted (found while copying the reference theme)

- **Decision**: Use the `@fontsource/poppins`, `@fontsource/inter` and `@fontsource/fira-code` npm
  packages, imported in `src/main.tsx`, so Vite bundles the font files as same-origin assets.
- **Why**: The reference app's `theme/fonts.ts` injects Google Fonts `<link>` tags at runtime. That
  is a third-party request, which Principle I forbids and the page CSP (`connect-src`,
  `font-src 'self' data:`) would block. `tokens.css` is copied unchanged because it only names the
  families.
- **Alternative**: Vendor the font files by hand (more upkeep, same result).

## R16. Icons and the theme preference

- **Decision**: Add `lucide-react` (the reference header and theme toggle use it), and keep the
  reference's light/dark preference in `localStorage` under an app-specific key.
- **Why**: Icons ship in the bundle and make no requests. The theme preference is a display setting,
  not data and not a tracking identifier; it is the only thing the app ever writes to browser
  storage. The reload and privacy tests (T071, T076) therefore assert that no key except the theme
  preference exists.
- **Note**: This updates the R12 dependency table: `lucide-react` is now used (the earlier
  "skipped" note is superseded).

## Spike results (2026-10-30)

Run in Chromium against the strict-CSP production build (`npm run test:e2e`). Pinned engine:
`@duckdb/duckdb-wasm` 1.33.1-dev57.0, which runs **DuckDB v1.5.4**.

| Item | Result | Effect on the plan |
|---|---|---|
| **R9** DuckDB under the strict CSP (T015) | **Pass.** `SELECT 42` and `version()` run with zero CSP violations. A cross-origin `fetch` is blocked from both the page and a worker (`connect-src`). | CSP stays exactly as in `vite.csp.ts`; no extra sources needed |
| **R1** 500 MB CSV into an in-memory all-text table (T016) | **Pass.** 525 MB file, 470,000 rows x 117 columns loaded in 4.1 s straight from the `File`; JS heap stayed about 10 MB (the data lives in WASM memory). | No fallback needed: T091 is "not needed" |
| **R2** `read_csv` encodings (T017) | **Partial.** UTF-8 with and without a BOM: pass. UTF-16 little endian (`encoding='utf-16'`): pass. **UTF-16 big endian: fails** ("File is not utf-16 encoded"). **Windows-1252 as `latin-1`: fails** when the file holds bytes 0x80-0x9F (for example the Euro sign), because Latin-1 does not define them. | The transcoding fallback T120 is **required** for UTF-16 BE and Windows-1252 (see below) |
| **R14** 500 MB Blob download (T018) | **Pass in Chromium.** The Blob built in 0.3 s and downloaded all 500 MB. Firefox and WebKit are checked later by T086. | No streamed-save fallback needed for Chromium: T092 is "not needed" for now |

### R2 follow-up: transcoding design (T120)

- **Native**: UTF-8 (with or without BOM) and UTF-16 LE go straight to `read_csv`.
- **Transcode**: UTF-16 BE and every Windows-1252 file are decoded with `TextDecoderStream` in the
  profile worker and written, as UTF-8, into an in-memory buffer registered with DuckDB
  (`registerFileBuffer`). Nothing is stored outside memory, so reload still clears everything.
- **Cost**: the buffer is held in memory next to the table, so these files need roughly twice the
  memory. The size warning (T090) must say so for such files.
- **Why not always read Windows-1252 as Latin-1**: it only works when no byte falls in 0x80-0x9F,
  which cannot be known without scanning the whole file first.
