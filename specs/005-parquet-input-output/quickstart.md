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

## Done when

Scenarios A to E pass in Chromium, Edge, Firefox and WebKit (A and D at least), the offline test has a Parquet session, and `tasks.md` has no unchecked task. Person timing sign-off for SC-008 is recorded here.
