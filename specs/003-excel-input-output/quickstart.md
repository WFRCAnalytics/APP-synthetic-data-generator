# Quickstart: Validate Excel Input and Output

**Feature**: 003-excel-input-output

Prerequisites and setup are those of `specs/001-csv-synthetic-slice/quickstart.md`. Excel fixtures
come from `python scripts/make-xlsx-fixtures.py` (needs `xlsxwriter` and `openpyxl`; the built
files are committed, so Python is only needed to change them). `npm run dev` and `npm run build`
fetch the Excel extension first (`scripts/fetch-extensions.mjs`, needs network once).

## Automated checks

```bash
npm run lint && npm run typecheck && npm test
npm run test:e2e                 # Chromium, includes the extension smoke test
npm run test:e2e:browsers        # plus Firefox and WebKit
```

## Scenario A: a workbook in, a fake workbook out (User Story 1)

1. Choose `tests/fixtures/xlsx/quirks.xlsx`. The dialog lists Notes, Survey Data and Lookup (hidden), with no cell value.
2. Pick Survey Data; the dialog suggests skipping 2 rows; confirm.
3. Review the columns, generate, download the fake workbook.
4. Read both with the same code, for example `pandas.read_excel(path, sheet_name="Survey Data", skiprows=2)`.

**Expect**: same sheet name, header position, column names and order, and column types.

## Scenario B: the quirks (User Story 2)

1. Compare the real and fake `quirks.xlsx` columns: zip codes as text with zeros, amounts with `#,##0.00`, percent, dates with `mm/dd/yyyy`, blank cells and empty text, a formula column, a merged heading.

**Expect**: each column has the same type and number format; blank and empty text counts match; no formula text; the app says merged cells were found.

## Scenario C: size and spec (User Story 3)

1. Choose a large workbook: the warning shows before profiling. Save the spec.

**Expect**: the spec has the sheet, range, rows skipped, header, date system and format codes, and no cell value; loading it without a workbook still generates a fake workbook.

## Scenario D: nothing real is kept (User Story 4)

1. Run Scenario A with the network tab open on a workbook whose other sheets, title row and comments hold marker strings.
2. Run `npm test -- xlsx-privacy` and the e2e privacy spec.

**Expect**: no marker anywhere; no request outside the site; a damaged, encrypted or .xls file gets a clear message with no cell content.

## Scenario E: scale

1. `python scripts/make-xlsx-fixtures.py --large` writes a 50 MB workbook to `.fixtures/` (gitignored).
2. `SCALE_XLSX=1 npx playwright test excel-scale.spec`.

**Expect**: profile and export each under 5 minutes; a workbook beyond the stop limit is refused with the message.

## Done when

All scenarios pass in Chrome and Edge, A and D also in Firefox and WebKit, and `tasks.md` has no
unchecked task for this feature.

## Results (recorded 2026-10-31)

| Scenario | Chromium | Edge | Firefox | WebKit | Evidence |
|----------|----------|------|---------|--------|----------|
| A: workbook in, fake workbook out, read back | pass | pass | pass | pass | `excel-flow.spec` (openpyxl cross-check) |
| B: quirks | pass | pass | pass | pass | `excel-quirks.spec`, `xlsx-writer`, `xlsx-metadata` unit tests |
| C: size and spec | pass | pass | pass | pass | `excel-flow.spec`, `workbook-dialog`, `spec-load`, `size-warning` tests |
| D: nothing real is kept | pass | pass | pass | pass | `excel-flow.spec` leak test, `xlsx-privacy` test |
| E: scale (73 MB, 600,000 rows by 20) | profile 27 s, export 25 s | not run | not run | not run | `excel-scale.spec`, research R14 |

Accessibility: `a11y.spec` passes for the workbook dialog and the cell format editor in light and dark themes (Chromium).

**Person-timing sign-offs still to be done by a maintainer** (an automated run cannot stand in for them): slice 3 SC-008 (an analyst loads a typical workbook and gets a fake workbook that reads back in their own R or pandas code), and slice 1 SC-007 and SC-008.

