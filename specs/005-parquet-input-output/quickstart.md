# Quickstart: Parquet input and output

## Prerequisites

Node 24, `npm ci`, Python with `pyarrow` (fixtures and read-back), Playwright browsers.
`python scripts/make-parquet-fixtures.py tests/fixtures/parquet` builds the fixtures (all codecs, nested columns, planted markers, a damaged file, a non-Parquet file).

## Scenario A: a file in and a fake file out (User Story 1)

1. Open the app, choose `tests/fixtures/parquet/types_snappy.parquet`.
2. Read the structure card: 5,000 rows, 14 columns, 3 row groups, no value.
3. Review, generate, download `types_snappy_fake.parquet`.

**Expect**: the downloaded file opens in pyarrow and DuckDB with the same column names, order and logical types as the real file (nested columns aside); `npx playwright test parquet-flow` does the same through the app.

## Scenario B: types survive (User Story 2)

1. Compare `pq.read_schema` of the real and fake files.

**Expect**: int16 stays int16, uint8 stays uint8, decimal(10,2) stays decimal(10,2), float32 stays float32, date, timestamp (unit and zone flag) and bool are the same; required stays required.

## Scenario C: nested columns (User Story 3)

1. Load the same file: `tags`, `pt` and `kv` are unsupported with a reason that names the kind.

**Expect**: they are left out of the fake file by default; the saved spec holds only their names and kinds.

## Scenario D: nothing real is kept (User Story 4)

1. `npx playwright test parquet-privacy` and `npx vitest run parquet-privacy`.

**Expect**: no marker from data, key-value metadata, created-by or statistics anywhere; the fake file's footer shows this app as creator, no key-value metadata, no statistics; a damaged or non-Parquet file gets a plain message.

## Scenario E: offline and browsers

1. `npm run release`, then `npx playwright test offline-zip` (has a Parquet session); `npm run test:e2e:browsers`.

**Expect**: all pass; zero outside requests.

## Results (recorded 2026-11-01)

| Scenario | Result | Evidence |
|----------|--------|----------|
| A: a file in, a fake file out | pass in Chromium, Edge, Firefox, WebKit | `parquet-flow.spec` (pyarrow reads the downloaded file; schema equals the real one's, minus the nested columns; this app as creator, no key-value notes, no statistics) |
| B: types survive | pass | `parquet-readback.test` (the engine and pyarrow: int8 to int64, uint8 to uint64, float32/64, decimal 9/18/38 digits exact, bool, string, date, time ms/us, timestamp ms/us/ns with and without UTC, required and optional) |
| C: nested columns | pass | `parquet-load.test`, `parquet-ingest.test`, `review-parquet.test`, `parquet-flow.spec` (spec holds only name, type "unsupported", exclude) |
| D: nothing real is kept | pass in all four browsers | `parquet-privacy.test` (query spy: no marker returned, no footer query for creator, notes, statistics), `parquet-privacy.spec` (page, spec, preview, download decoded by pyarrow, console, storage; control: the real file does decode to its markers) |
| E: offline and browsers | pass | `offline-zip.spec` Parquet session (reader served by the folder, zero outside requests, file equal to the hosted build's) in Chromium, Edge, Firefox, WebKit |
| Scale | profile 121 s, export 138 s for 511 MB once opened | `parquet-scale.spec`, research R13 |

Accessibility: `a11y.spec` passes for the structure card, the unsupported notes and the Review file types, in light and dark themes.

**Still for a person**: SC-008, someone who has never seen the tool chooses a Parquet file and reaches Review in under 2 minutes without instructions.

## Done when

Scenarios A to E pass in Chromium, Edge, Firefox and WebKit (A and D at least), the offline test has a Parquet session, and `tasks.md` has no unchecked task. Person timing sign-off for SC-008 is recorded here.
