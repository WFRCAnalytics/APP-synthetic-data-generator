# Contract: Worker Message Protocol

**Feature**: 001-csv-synthetic-slice

The UI thread never touches real rows. Two dedicated workers do the heavy work and talk to the UI by
messages. All payloads are structured-clone safe, and none carries a real data row.

## 1. Profile worker (owns DuckDB and the real data)

Lifetime: created when a file is chosen; terminated on reload, on "start over", or when the user
loads a spec (which does not need it).

### UI to worker

| Message | Payload | Meaning |
|---|---|---|
| `open` | `file: File` | Register the file handle and detect settings (`sniff`) |
| `load` | `settings: FileSettings` | Read the CSV into the in-memory table (all text) |
| `profile` | `threshold: number` | Compute summaries in column batches |
| `reprofile` | `column: string`, `overrides` | Recompute one column after a type or format change |
| `datePattern` | `column: string`, `pattern: string` | Count how many non-NA values parse |
| `cancel` | none | Stop the current job |

### Worker to UI

| Message | Payload | Meaning |
|---|---|---|
| `settingsDetected` | `FileSettings`, `confidence` | Delimiter, encoding, quote, header |
| `loaded` | `rowCount`, `columnNames` | Names and counts only, never values |
| `progress` | `job`, `done`, `total` | Fraction of work finished |
| `columnProfile` | `ColumnProfile` | One summary (no rows) |
| `datePatternResult` | `parsed`, `total` | Counts only |
| `error` | `code`, `message` | `message` MUST NOT contain any cell value |

**Rule**: error text may name a column and a row *number*, never a cell value.

## 2. Generate worker (spec only, no DuckDB)

Receives the Spec and a seed. It never receives the real file, which is why a saved spec can be
reused without the data.

### UI to worker

| Message | Payload | Meaning |
|---|---|---|
| `generate` | `spec: Spec`, `seed: number`, `chunkRows: number` | Start a run |
| `cancel` | none | Stop |

### Worker to UI

| Message | Payload | Meaning |
|---|---|---|
| `preview` | `rows: string[][]` (first 50) | Fake rows for the preview table |
| `chunk` | `bytes: ArrayBuffer` (transferred) | Encoded CSV bytes, in order |
| `progress` | `rowsDone`, `rowsTotal` | Progress |
| `checks` | `CheckRow[]` | Target versus achieved per column |
| `done` | `totalBytes` | Finished |
| `error` | `code`, `message` | Failure |

Chunk size does not affect output bytes (see research.md R5).

## 3. Network monitor (all workers)

Worker requests are invisible to the page's own resource timeline, and DuckDB downloads its WebAssembly
module from inside its own nested worker. So each worker runs `installNetPatch` (src/workers/netpatch.ts)
before anything else, and DuckDB's worker is started through a small blob wrapper that installs the same
patch and then loads DuckDB's script. The patch wraps `fetch` and `XMLHttpRequest` and posts each URL
to a `BroadcastChannel` (`synthetic-data-generator:net`). The channel keeps these reports out of the
workers' own message protocols, including DuckDB's.

| Counter | Source |
|---|---|
| same-origin | The page's `PerformanceObserver` (resource entries) and worker reports whose origin equals the page's |
| cross-origin | Any other origin; expected to stay 0 |
| blocked | `securitypolicyviolation` events from the page's CSP |

`blob:`, `data:` and `about:` URLs point at memory and are not counted.

## 4. Page security policy

`index.html` carries a `Content-Security-Policy` meta tag: `default-src 'self'; script-src 'self'
'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'`.
Any change that widens it needs a recorded justification in research.md and maintainer approval,
because it affects Principle I.
