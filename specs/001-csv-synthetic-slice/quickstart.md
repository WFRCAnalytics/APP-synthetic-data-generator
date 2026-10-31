# Quickstart: Validate the CSV Synthetic Data Slice

**Feature**: 001-csv-synthetic-slice

A validation guide. Each scenario names the expected outcome, and the data model and contracts
define the details (`data-model.md`, `contracts/`). The commands below become valid as the tasks
land; until then they describe the target.

## Prerequisites

- Node.js 20 or newer, npm
- Current Chrome or Edge (Firefox and Safari for the download-fallback check)
- Fixture files generated locally; large files are never committed

## Setup

```bash
npm install
npm run fixtures        # writes small fixtures to tests/fixtures and a 500 MB file to .fixtures/ (gitignored)
npm run dev             # serves the app locally
```

## Automated checks

```bash
npm run lint
npm run typecheck
npm test                # unit, integration, component
npm run test:e2e        # Playwright; includes the network and reload checks
```

Expected: all pass.

## Scenario A: the whole flow (User Story 1)

1. Open the app, choose `tests/fixtures/zoo/zoo_small.csv`.
2. Confirm the detected delimiter, encoding, quote, header.
3. On Review, accept defaults, then continue to Generate.
4. Seed 42, Generate, then export the CSV.

**Expect**: same header and row count; the export name ends in `_fake.csv`; the preview shows 50
rows; the check table shows every exact metric as a pass; no real row appears before the preview.

## Scenario B: review and override (User Story 2)

1. Load `tests/fixtures/zoo/zoo_small.csv` (coded integers, sentinels, a few unsupported columns).
2. Confirm the coded column is categorical, and edit the sentinels on the numeric column.
3. Search, use the "needs attention" filter, and check the banner.

**Expect**: unsupported columns are excluded and flagged; sentinels are excluded from the
min, max, mean and standard deviation; all optional protections are off.

## Scenario C: IDs (User Story 3)

1. Load `tests/fixtures/zoo/ids_50k.csv` (50,000 household IDs).
2. Edit the mask in the editor; try a mask that is too narrow.
3. Save the spec and open it in a text editor.

**Expect**: a live sample updates; the narrow mask shows "allows X, needs Y" and blocks Generate;
the spec contains no fixture ID values and stays under 1 MB.

## Scenario D: reproducibility (User Story 4)

1. Save a spec, reload the page, load the spec, generate twice with the same seed.
2. Change one column's mode and generate again.

**Expect**: the two same-seed files are byte-identical; only the changed column differs.
A hand-edited bad value is reported by column name.

## Scenario E: privacy (User Story 5)

1. Run Scenario A while watching the counter and the browser's Network tab.
2. Reload the page.

**Expect**: cross-origin count 0 and blocked count 0; nothing but same-origin static files in the
Network tab; after reload, no data remains and the app is back at the start.

## Scenario F: scale (User Story 6)

1. Load `.fixtures/zoo_500mb.csv` (about 120 columns).
2. Profile, generate and export.

**Expect**: progress shown and the page responsive; profiling under 5 minutes and
generate-and-export under 5 minutes; any column found by search in under 15 seconds.

## Scenario G: format fidelity (SC-004)

1. Export a fake CSV for each fixture.
2. Run the parse script `npm run verify:roundtrip -- <real> <fake>`.

**Expect**: same column names, order and types, using the same parsing code for both files.

## Done when

All scenarios pass in Chrome and Edge, A and G also pass in Firefox and Safari via download, and
`tasks.md` has no unchecked slice-1 task other than those marked deferred.
