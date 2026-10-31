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
patterns), never rows, ID lists, free text, personal identifiers or coordinates.

## How it works

1. **Ingest**: pick a CSV. The app detects delimiter, encoding, quoting and header, and shows the
   row count, column count and column names. It never shows row values.
2. **Review**: one card per column. Override types, sentinels, NA tokens, numeric modes, ID
   patterns and exclusions, then save the spec.
3. **Generate**: set a seed, preview 50 fake rows, check every summary was met, and export the
   fake file in the same format as the original.

Use the fake file while an AI agent writes your analysis code, then swap in the real file (same
name and format) and run the code locally.

## Status

The core flow works end to end for CSV files: choose a file, confirm the detected settings, review
and change how each column is understood, generate, check the summaries, and download the fake file.
On Review you can search and filter the columns, change a column's type, confirm sentinel codes and
missing-value markers, type a date pattern, choose how numbers are generated, leave columns out, and
turn on the optional protections (merge rare categories, neutral labels, rename). A counter in the
header shows every network request since the page loaded, split into local and outside (always 0),
and the page's security policy makes the browser refuse any request to another site.

Next: survey ID patterns, saving and loading a spec, and a virtualized column list for very wide
tables. Everything still to do is tracked in
[`specs/001-csv-synthetic-slice/tasks.md`](specs/001-csv-synthetic-slice/tasks.md).

On a 525 MB, 117-column file it profiles in about 80 seconds and generates in about 50.

## Documents

- [`SPEC.md`](SPEC.md): the design document
- [`.specify/memory/constitution.md`](.specify/memory/constitution.md): project principles
- [`specs/001-csv-synthetic-slice/`](specs/001-csv-synthetic-slice/): spec, plan, research, data
  model, contracts, quickstart and tasks for the first slice

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
