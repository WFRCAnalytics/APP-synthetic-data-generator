# Synthetic Data Generator for AI Coding Agents

A client-only tool for WFRC that turns one private survey table into a fake table with the same
columns, row count, types, formats and summary statistics, so AI coding agents can build analysis
code without ever seeing real data.

**No backend, no uploads, no accounts, no analytics.** Everything runs in your browser tab. After
the page loads, the app makes only same-origin requests, and the page's Content-Security-Policy
makes the browser refuse anything else. A live counter in the header shows the request counts.
Closing or reloading the page clears all real data from memory.

The only artifact derived from your data is the **spec file** you choose to download. It holds
summaries and settings only (category labels, exact min and max, sentinel codes, quantiles, ID
patterns, and for names, emails, phone numbers, addresses, free text and short codes only counts,
lengths and patterns), never rows, ID lists, free text, personal identifiers or coordinates.

## How it works

1. **Ingest** (or **Design**): pick a CSV, an Excel workbook (.xlsx), a Parquet file (.parquet) or a JSON file (.json, .ndjson, .jsonl), or start from scratch and describe the columns of a table yourself (numbers between limits, categories with weights, dates, IDs, invented personal details), written as a CSV, Excel, Parquet, JSON or JSON Lines file as you choose. For a CSV the app detects delimiter, encoding,
   quoting and header; for a workbook it lists the sheet names and you choose a sheet, the rows to
   skip above the header and, if you like, a cell range. It shows the row count, column count and
   column names, never row values.
2. **Review**: one card per column. Override types, sentinels, NA tokens, numeric modes, ID
   patterns and exclusions, then save the spec.
3. **Generate**: set a seed, preview 50 fake rows, check every summary was met, and export the
   fake file in the same format as the original.

Use the fake file while an AI agent writes your analysis code, then swap in the real file (same
name and format) and run the code locally.

## Status

The first slices work end to end for CSV, Excel (.xlsx), Parquet and JSON files: choose a file, confirm the detected settings,
review and change how each column is understood, generate, check that every summary was met, and
download the fake file and the spec.

- **Column types**: categorical (including coded integers and Yes/No), integers and decimals, dates
  and times, survey IDs (a pattern with an editor and a live sample), **personal identifiers**
  (names, emails, US phone numbers, street addresses, URLs, IP addresses, and social-security-style
  numbers after an explicit acknowledgement), **free text** (lengths only) and **short strings**
  (a character pattern). Personal values are always invented from word lists; none is copied.
- **Review**: search, filters, per-column overrides, optional protections, and a virtualized list for
  very wide tables.
- **Excel**: the chosen sheet is read in the browser with DuckDB's Excel reader (served from this site,
  nothing fetched from elsewhere). The fake workbook holds that one sheet, with the same sheet name,
  header position, column names and order, text, number and date cells, and number formats (leading
  zeros stay text; blank cells and empty text stay apart; dates in either date system). Formulas are
  read as their values. Merged cells, hidden sheets and columns of mixed kinds are flagged. Not read:
  old `.xls`, macro workbooks (`.xlsm`), and charts or other formatting. Sheets over about 1 GB once
  opened are refused; over 100 MB gets a warning.
- **Parquet**: the file is read in the browser with DuckDB's Parquet reader (a file this site serves itself,
  nothing fetched from elsewhere), and only its structure is shown: row count, row groups, and each column's
  name and type. The fake file has the same column names, order and logical types (integer width and sign,
  decimal precision and scale, float width, date, time, timestamp unit and time zone, boolean, string) and the
  same nullability, with values kept inside each type's range. Nested columns (list, struct, map) and raw
  binary are not read or faked. The file's key-value notes, creator text and row-group statistics are never
  read; the fake file names this app as its creator and carries none of them. Pages are gzip-compressed.
- **JSON**: a list of records or one record per line (NDJSON, JSON Lines) is read in the browser with DuckDB's
  JSON reader (a file this site serves itself, nothing fetched from elsewhere), and only its structure is shown:
  record count, keys in first-seen order and the kind of each key. The fake file is in the same form, with the same
  keys in the same order, each written as the same JSON kind (number, text, true or false), exactly as many nulls
  and as many absent keys as the real file, and the same indent, line ending and trailing newline. A key that mixes
  numbers and text is read and written as text; keys that hold objects or lists are not read or faked.
- **Languages and regions**: invented names, emails, phone numbers and street addresses can come from the United States (default),
  Spain, Mexico, France, Germany or Brazil, chosen per personal column.
- **Coordinates**: latitude, longitude and map-position columns keep only their bounding box and decimal places; values are
  spread evenly inside it. Combined coordinates and WKT shapes are still left out.
- **Codebook**: add a CSV or JSON codebook on Review to say what the codes of a coded column mean; the labels show on Review
  and in the README for agents, and the fake file keeps the codes.
- **README for agents**: next to the fake file and the spec, a Markdown page that says the data is not real, how the file is laid
  out, what each column holds and how to use it. It is built from the spec alone.
- **Spec files**: save, load (the current version only while the app is in beta), and generate from a spec alone.
  A workbook spec makes a workbook, a Parquet spec a Parquet file and a JSON spec a JSON file.
- **Privacy**: a live request counter and a strict Content-Security-Policy. Tests prove that no
  real value of any column reaches the page, the spec, the preview, the file or an error message.
- **Browsers**: tested in Chrome, Edge, Firefox and WebKit.

Not yet: coordinates, other languages for invented values, several tables,
the offline zip release. The backlog is in
[`specs/001-csv-synthetic-slice/tasks.md`](specs/001-csv-synthetic-slice/tasks.md) and the slice 2
list in [`specs/002-personal-text-columns/tasks.md`](specs/002-personal-text-columns/tasks.md).

On a 525 MB, 117-column file it profiles in about 80 seconds and generates in about 60.

## Offline copy

Every release has a zip that runs from a folder with no internet and no install, for machines that
cannot reach the web page. Unzip it, then double-click `start.cmd` (Windows) or run `./start.sh`
(macOS, Linux, needs `python3`). Browsers will not run an app straight from a file, so the zip holds a
small launcher that shows the same site to your browser from that folder, on your computer only; it makes
no outside connection. The zip also holds a one-page `README.txt`, `CHECKSUMS.sha256` (a SHA-256 for every
file) and `LICENSES.md`. The release name and the page header show the app version and the spec file
version it writes (for example `v0.2.0 · writes spec v3`), so a saved spec can be matched to a release.
There is no auto-update: download a newer zip for a newer version.

## Releasing

1. Set the new `version` in `package.json` and commit it to `main`.
2. Tag it `v<version>` (for example `v0.2.0`) and push the tag.
3. The `Release (offline zip)` workflow runs lint, types, tests and the build, builds and verifies the
   zip, runs the real launcher on Linux, macOS and Windows with every request that is not to the launcher
   refused, and only then attaches the zip and `CHECKSUMS.sha256` to a release named
   `v<version> (writes spec v<N>)`. A tag that is not `v<package version>` fails the first check.
4. To try it without publishing, use Actions, Release (offline zip), Run workflow, with a tag name such as
   `v0.2.0-rc1`.

To build the same zip yourself: `npm run release` writes `release-out/`, `npm run verify:release` checks it,
and `npx playwright test offline-zip offline-guard` runs it. The build is reproducible: the same commit
gives the same file checksums (file times come from the commit date, or `SOURCE_DATE_EPOCH`).

## Documents

- [`SPEC.md`](SPEC.md): the design document
- [`.specify/memory/constitution.md`](.specify/memory/constitution.md): project principles
- [`specs/001-csv-synthetic-slice/`](specs/001-csv-synthetic-slice/): spec, plan, research, data
  model, contracts, quickstart and tasks for the first slice
- [`specs/002-personal-text-columns/`](specs/002-personal-text-columns/): the same for personal
  identifier, free text and short string columns
- [`specs/003-excel-input-output/`](specs/003-excel-input-output/): Excel workbooks in and out
- [`specs/005-parquet-input-output/`](specs/005-parquet-input-output/): Parquet files in and out
- [`specs/004-offline-zip-release/`](specs/004-offline-zip-release/): the offline zip release
- [`specs/007-json-input-output/`](specs/007-json-input-output/): JSON files in and out

## Development

Requires Node.js 20 or newer.

```bash
npm install
npm run dev          # start the Vite dev server
npm run test         # unit, integration and component tests (Vitest)
npm run test:e2e     # browser tests (Playwright)
npm run lint         # ESLint
npm run typecheck    # TypeScript
npm run build        # production build -> dist/
npm run fixtures     # generate test fixtures (see contracts/fixture-matrix.md)
node scripts/fetch-corpus.mjs   # download other people's CSV edge cases for the robustness test
```

`npm run dev` and `npm run build` first copy the DuckDB-WASM binaries from `node_modules` into
`public/duckdb/` (git-ignored) so the app serves them itself.

## License

[MIT](LICENSE)
