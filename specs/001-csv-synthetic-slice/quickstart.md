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

## Results (T096)

Run on 2026-10-31 on the reference machine (Windows 11, current Chromium 1228 build, installed
Microsoft Edge, Playwright Firefox and WebKit builds). Automated parts are repeatable with the
commands shown.

| Scenario | Chrome (Chromium) | Edge | Firefox | Safari engine (WebKit) | How |
|---|---|---|---|---|---|
| A: whole flow | pass | pass | pass | pass | `flow.spec`, `download-fallback.spec` |
| B: review and override | pass | pass | not run (not required) | not run (not required) | `review.spec`, component tests |
| C: IDs | pass | pass | not run (not required) | not run (not required) | `quickstart.spec` scenario C |
| D: reproducibility | pass | pass | not run (not required) | not run (not required) | `quickstart.spec` scenario D, `determinism.test.ts` |
| E: privacy | pass | pass | pass (no outside request in the flow test) | pass (same) | `privacy.spec`, `flow.spec` |
| F: scale | pass (525 MB) | small table pass | not run (not required) | not run (not required) | `scale.spec`; large run needs `SCALE_500MB=1` |
| G: format fidelity | pass (Node) | n/a | n/a | n/a | `verify-script.test.ts`, `roundtrip.test.ts` |

Commands: `npm run test:e2e` (Chromium), `PW_EDGE=1 npx playwright test --project=edge` (Edge),
`npm run test:e2e:browsers` (Chromium, Firefox, WebKit: flow and download tests).

Notes:

- The WebKit build is Playwright's, the engine Safari uses. It is not Apple Safari itself, so a
  check in real Safari on a Mac remains worthwhile before release.
- Scenario F, 525 MB file with 117 columns: profile 83 s, generate and check 60 s (both under the
  5-minute target), search 14 ms, longest frame while profiling 10 ms (page never froze).
- The a11y test (`a11y.spec`) found and fixed four problems: low-contrast links inside warning
  banners, no focus indicator on the Settings toggle, low-contrast table headers, and scrolling
  tables the keyboard could not reach. It also led to a lighter danger text colour in dark mode
  (`--color-danger-text`), with a unit test on every text colour pair (`contrast.test.ts`).

### Human timing checks (SC-007, SC-008): not done by the automated run

These measure a person, so a person must do them. Machine time is recorded as evidence only.

- **SC-007** (typical table to fake CSV in under 10 minutes): machine time for `zoo_small.csv`
  (82 columns, 2,000 rows) from choosing the file to the download is about 3 seconds, so the target
  leaves almost all of the 10 minutes for the person reviewing columns.
- **SC-008** (find any column in a 120-column table in under 15 seconds): search returns in 14 ms
  on the 117-column file. The person-timing check is for the maintainer.

Maintainer sign-off: SC-007 [ ]  SC-008 [ ]
