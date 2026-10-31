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

1. **Ingest**: pick a CSV or an Excel workbook (.xlsx). For a CSV the app detects delimiter, encoding,
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

The first three slices work end to end for CSV and Excel (.xlsx) files: choose a file, confirm the detected settings,
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
- **Spec files**: save, load (version 1 to 3), and generate from a spec alone. A workbook spec makes a
  workbook.
- **Privacy**: a live request counter and a strict Content-Security-Policy. Tests prove that no
  real value of any column reaches the page, the spec, the preview, the file or an error message.
- **Browsers**: tested in Chrome, Edge, Firefox and WebKit.

Not yet: Parquet files, coordinates, other languages for invented values, several tables,
the offline zip release. The backlog is in
[`specs/001-csv-synthetic-slice/tasks.md`](specs/001-csv-synthetic-slice/tasks.md) and the slice 2
list in [`specs/002-personal-text-columns/tasks.md`](specs/002-personal-text-columns/tasks.md).

On a 525 MB, 117-column file it profiles in about 80 seconds and generates in about 60.

## Documents

- [`SPEC.md`](SPEC.md): the design document
- [`.specify/memory/constitution.md`](.specify/memory/constitution.md): project principles
- [`specs/001-csv-synthetic-slice/`](specs/001-csv-synthetic-slice/): spec, plan, research, data
  model, contracts, quickstart and tasks for the first slice
- [`specs/002-personal-text-columns/`](specs/002-personal-text-columns/): the same for personal
  identifier, free text and short string columns

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
