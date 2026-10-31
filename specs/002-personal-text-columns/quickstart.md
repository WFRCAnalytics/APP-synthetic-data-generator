# Quickstart: Validate Personal, Free Text and Short String Columns

**Feature**: 002-personal-text-columns

Prerequisites and setup are the same as `specs/001-csv-synthetic-slice/quickstart.md`.
The text fixtures (`tests/fixtures/zoo/text_50k.csv` and new columns in `zoo_small.csv`) come from
`npm run fixtures`.

## Automated checks

```bash
npm run lint && npm run typecheck && npm test
npm run test:e2e                 # Chromium
npm run test:e2e:browsers        # plus Firefox and WebKit
```

Expected: all pass, including the leak and bundle checks.

## Scenario A: names, emails, phones, addresses (User Story 1)

1. Load `tests/fixtures/zoo/text_50k.csv` (50,000 distinct names, emails, phones, addresses).
2. Review: each personal column shows its kind and a live sample; change a name column from full to last name.
3. Generate, download, compare with the real file.

**Expect**: same distinct and missing counts per column; the check table passes; no fake value
equals a real one by design; the sample updates when the kind changes.

## Scenario B: free text (User Story 2)

1. Load the table with the `comments` column and generate.

**Expect**: shortest, longest and median lengths equal the real ones; no real word in the output or spec.

## Scenario C: short strings (User Story 3)

1. Load the table with the `plate` and `vendor_code` columns and generate.

**Expect**: same lengths, character patterns and distinct counts; check rows pass.

## Scenario D: nothing real is kept (User Story 4)

1. Run Scenario A with the network tab open; save the spec and open it in an editor.
2. Run `npm test -- personal-inference text-privacy` and the e2e privacy spec.

**Expect**: no real name, email, phone, address, word or code in the page, preview, spec, file or
errors; the spec for 50,000 names is under 100 KB; the profile worker bundle holds no word lists.

## Scenario E: SSN-style acknowledgement

1. Load a table with an SSN-like column: it is left out with an explanation.
2. Tick the acknowledgement: the column is generated in the 9xx-xx-xxxx range.

**Expect**: untick returns it to left out; values never fall in an assigned range.

## Scenario F: older spec and scale

1. Load a spec saved by slice 1 that marks a column unsupported; switch it to a kind on Review.
2. Run `SCALE_500MB=1 npx playwright test scale.spec` on the 500 MB fixture with text columns.

**Expect**: the version 1 spec loads; profile and generate stay under 5 minutes each.

## Done when

All scenarios pass in Chrome and Edge, A and D also in Firefox and WebKit, and `tasks.md` has no
unchecked task for this feature.

## Results (T052, T054, T062)

Run on 2026-10-31 on the reference machine (Windows 11; Playwright Chromium, the installed
Microsoft Edge, Playwright Firefox and WebKit builds). Repeat with the commands shown.

| Scenario | Chrome (Chromium) | Edge | Firefox | Safari engine (WebKit) | How |
|---|---|---|---|---|---|
| A: names, emails, phones, addresses | pass | pass | pass | pass | `quickstart.spec` slice 2 scenario A |
| B: free text | pass | pass | not run (not required) | not run (not required) | `generate-free-text.test.ts`, `personal-profile.test.ts`, `review-personal.test.tsx` |
| C: short strings | pass | pass | not run (not required) | not run (not required) | `generate-short-string.test.ts`, `personal-profile.test.ts` |
| D: nothing real is kept | pass | pass | pass (no outside request in the flow test) | pass (same) | `privacy.spec`, `personal-inference.test.ts`, `text-privacy.test.ts`, `bundle-wordlists.test.ts` |
| E: SSN-style acknowledgement | pass | pass | pass | pass | `quickstart.spec` slice 2 scenario E |
| F: old spec, and scale | pass | small table pass | pass (spec part) | pass (spec part) | `quickstart.spec` scenario F, `scale.spec` |

Commands: `npm run test:e2e` (Chromium), `PW_EDGE=1 npx playwright test --project=edge` (Edge),
`npm run test:e2e:browsers` (Chromium, Firefox, WebKit: flow, download and quickstart tests).
The WebKit build is Playwright's, the engine Safari uses, not Apple Safari itself.

### Scale (T052)

525 MB file with 123 columns, including personal, free text and short string columns, in Chromium:
profile 81 s, generate and check 67 s (both under the 5-minute target), search 12 ms, longest frame
while profiling 16 ms. Run with `SCALE_500MB=1 npx playwright test scale.spec` after
`node scripts/make-fixtures.mjs --large`.

### Results that shaped the build

- A spy test on the data engine found that the frequent-value query still ran for social-security-style
  numbers and IP addresses (their shapes looked like dates) and for zip codes (they looked like
  numbers). The rules were tightened and the test now covers 17 text columns.
- Detecting emails and URLs from exact character shapes failed when lengths varied, as they do in
  real data. Detection now also uses run-collapsed shapes (`A.A@A.A`).
- A short string column whose characters vary too much for any pattern (the corpus file of every
  Latin-1 character) is left out with the "too narrow" reason until the user widens the pattern.

### Human timing check (SC-008): not done by the automated run

Changing a personal column's kind and seeing a new sample takes under a second here (the sample
comes back from the generating worker in the browser tests). The person-timing check is for the
maintainer, together with SC-007 and SC-008 of slice 1.

Maintainer sign-off: slice 2 SC-008 [ ]  slice 1 SC-007 [ ]  slice 1 SC-008 [ ]
