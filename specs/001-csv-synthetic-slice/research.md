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

## Slice 1 build notes (2026-10-31)

Decisions that changed or were refined while building, with the numbers behind them.

### Measured performance (Chromium, strict CSP, the 525 MB zoo file: 470,000 rows, 117 columns)

| Step | Time | Target (SC-001) |
|---|---|---|
| Profile all 117 columns | 84 s | under 5 minutes |
| Generate, measure and check the output (245 MB file; unsupported columns are dropped) | 50 s | under 5 minutes |
| Check table | all 256 checks passed | |

### R3 refined: one query set per column, type from a sample

- Profiling runs a fixed set of queries **per column** instead of batches of 20, which gives progress
  after every column and was already fast enough (84 s for 117 columns).
- The **type** is decided on a random 50,000-row sample (character shapes, top values), then
  **exact** numbers (counts, min, max, mean, sd, percentiles, decimals) come from the full table.
  A date pattern is verified against every value before it is accepted.

### R1/R2 refined: DuckDB's sniffer is not used

- Our TypeScript sniffer finds the delimiter, quote style (including per-column quoting), header,
  line ending and column names, and DuckDB gets **explicit options with auto-detect off**.
- Reason: with auto-detect on, DuckDB silently misread `ragged.csv` (0 rows, no error). With it off,
  a ragged file fails loudly.
- `read_csv`'s `new_line` option rejects every spelling tried; none is needed, because LF, CRLF and
  CR-only files all read correctly with auto-detect off.

### Bugs the corpus robustness test found (75 files from DuckDB and csv-spectrum), now fixed and pinned

| File | Bug | Fix |
|---|---|---|
| `decimal.csv` | A column with 16 decimal places made a spec the validator rejects (limit 15) | Decimals are capped at 15 |
| `all_utf16.csv` (run after a large file) | A leftover sample table broke loading a second file in the same session | The sample table or view is dropped first |
| `empty_first_line.csv` | A one-column row with a missing value was written as a blank line, which readers skip | Written as `""` |
| `small_bad.csv` | None in the app: re-detecting a headerless file can mistake a text row for a header | Test re-reads with the source's header setting; the user can set the header box on Ingest |

The end-to-end zoo test found four more before that: scientific notation (`1.2e-5`) was written as
fixed decimals, constant columns drifted outside `[min, max]` by floating-point error, the mean
check was judged against 5% of a mean near zero, and a test compared quoting flags for columns that
are not written.

### Known limitations (documented, not bugs)

- Scientific notation is written as `1.2e-5` (JavaScript style), not `1.2e-05` (Python style).
- A date column whose days are all 12 or less is flagged ambiguous (day-month or month-day). The
  generated dates then use days up to 31 in the same pattern, so the fake column is no longer
  ambiguous; this is inherent to generating each column independently.
- A numeric column with a heavy tail (log-normal) can only be matched approximately by a beta fit;
  "match shape" keeps the shape, and the optional rescale (User Story 2) restores mean and sd.
- Header detection is a heuristic. For a file whose first row is text and whose other rows are text,
  the user confirms or corrects the "first row is a header" box on the Ingest screen.

## User Story 2 build notes (2026-10-31)

### Two kinds of change on Review

- **Needs no data, applied at once:** leave a column out, numeric mode, decimals, rescale, the label
  protections, renaming. They are kept apart from what the worker reports (`src/lib/profile/edits.ts`)
  and applied on top, so they survive any later re-profile. An edit that does not fit the column's
  current type is ignored rather than failing, and applies again if the type comes back.
- **Needs the data, sent to the worker:** type, sentinel codes, the missing-value markers, a typed
  date pattern. The worker profiles that one column again with the overrides. The overrides are
  also sent with a full re-profile, so changing the categorical limit keeps them.

### A chosen type is honored only when the values allow it

| Chosen | Allowed when | Otherwise |
|---|---|---|
| Categorical | up to 2,000 distinct values | detected type kept, with a note |
| Yes / No | exactly two distinct values | detected type kept, with a note |
| Integer / decimal | the values are numbers (a few stray markers become missing values), no leading zeros; integer also needs whole numbers | detected type kept, with a note |
| Not supported | always | |
| Date | by typing a pattern that parses every value (decision Q2) | column becomes unsupported |

### Rescale (FR-027)

A single affine transform is not enough: clipping to `[min, max]` shifts the statistics again. The
column is regenerated five times (free, since every value is a pure function of its row) while an
affine map is refined. The two rows that carry the exact min and max are excluded from the fit and
never moved, so SC-002 still holds. On a skewed column the fitted mean and sd land within about 0.2%
of the target, against several percent without it.

### Bugs found

| Where | Bug | Fix |
|---|---|---|
| Profiling SQL | Clearing every NA token built `NOT IN (NULL)`, which is never true, so every value was dropped and the column read as empty | An empty token list means no filter |
| Card and editor | Sentinel codes listed as "998, 999, -9" because object keys put whole numbers first | Always shown in numeric order |
| Settings panel | The labels "In the fake file" and "Name in the fake file" overlapped, which is ambiguous for assistive technology and for tests | The rename field is "New column name" |
| Date pattern box | Its wrapper used `data-column`, the same attribute the cards use for lookup | Renamed `data-date-pattern-for` |
| Network counter | It was a `status` live region and would have announced every count change | Now a labelled group |

### Known limits

- Changing the categorical limit profiles every column again (84 s on the 525 MB file), with a
  progress bar; one column's own changes re-profile only that column.
- The settings of a card are built only when it is opened, so a hundred cards stay light. Lists
  longer than 100 columns are drawn through a window (`ColumnList.tsx`), so a 117-column table keeps
  only the cards near the screen in the page.

## Dependency audit (T095)

Checked on 2026-10-31 against `package.json`, the production build in `dist/`, and `npm audit`.

### Runtime dependencies (shipped to users)

| Package | Can it make a network request or send telemetry? | Verdict |
|---|---|---|
| `@duckdb/duckdb-wasm` | Loads its own worker and WASM from URLs the app gives it (same origin, `public/duckdb/`). DuckDB can fetch an extension from the internet when a query needs one. | Kept. The profile worker now sets `autoinstall_known_extensions` and `autoload_known_extensions` to false at start, and the CSP `connect-src 'self'` would block and count an attempt anyway. |
| `react`, `react-dom` | No. The production build holds the string `reactjs.org/docs/error-decoder.html` in an error message, never fetched. | Kept. |
| `valibot` | No. Pure validation. | Kept. |
| `lucide-react` | No. Inline SVG components; no icon font or CDN. | Kept. |
| `@tanstack/react-virtual` | No. Measures the DOM only. | Kept. |
| `@fontsource/inter`, `poppins`, `fira-code` | No. Font files are bundled and served from the site; there is no Google Fonts request (an earlier version had one; it was removed). | Kept. |

### Built bundle

- Every `http(s)://` string in `dist/` is an XML namespace (w3.org), a code comment (`js-sha256`), or the React error-decoder text above. None is requested.
- `XMLHttpRequest` appears in the two worker bundles only because the network counter wraps it (`src/workers/netpatch.ts`), and in DuckDB's own workers for same-origin loading.
- No `sendBeacon`, `WebSocket` or `EventSource`, and no analytics, tracking or cookie code.
- Browser tests (`tests/e2e/privacy.spec.ts`) record every request in a full session and find none outside the page's own origin.

### `npm audit`

- Production dependencies: 0 vulnerabilities.
- Development tooling: 22 reported (19 moderate, 1 high, 2 critical), all in `vite`, `vitest`, `esbuild`, `minimatch` and `tinypool` at the versions this slice pins. They run only on a developer machine or in CI and are never shipped. They are resolved by moving the toolchain to current majors, which is T103 in the deferred backlog.

### Added during the slice

`@axe-core/playwright` (development only) runs automatic accessibility checks in the browser tests. It runs in the test browser and is not part of the build.
