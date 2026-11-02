# Quickstart: JSON input and output

Prerequisites: `npm ci`; `python scripts/make-json-fixtures.py` (writes fixtures under `.fixtures/json/`,
gitignored); `npm run build:spike`.

1. **Array in, array out**: `npx playwright test json-flow`. Chooses `.fixtures/json/survey.json`, checks
   that the summary shows record count, key names and kinds and no value, reviews, generates, downloads
   `survey_fake.json`, and reads it back with the same code as the real file.
2. **Lines in, lines out**: the same test with `survey.ndjson`; the fake file has one record per line, no
   brackets.
3. **Null, missing, mixed**: `npx vitest run tests/integration/json-load.test.ts` and `json-readback`;
   counts of `null` and absent keys in the fake file equal the spec's.
4. **Privacy**: `npx playwright test json-privacy`; markers planted in values, nested values and key text
   do not appear on the page, in the spec, preview, download, console or storage; zero outside requests.
5. **Unsupported and refused**: `nested.json` shows the two nested keys as unsupported; `damaged.json`,
   `scalar.json`, `items.json`, `dup.json` and `empty.json` each end in a plain message.
6. **Offline**: `npm run test:e2e:offline` includes a JSON session served from the unzipped folder.
