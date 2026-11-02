# Feature Specification: SAS transport output, and SPSS, Stata and SAS transport for any upload

**Status**: Complete

The app writes SAS transport files (.xpt, version 5): a published format that every SAS tool opens (unlike the .sas7bdat ReadStat
writes). An .xpt upload is written back as an .xpt by default, and every upload can now be written as SPSS, Stata or SAS transport
from the "File type" choice on Generate.

- **FR-001**: Numbers are IBM floating point, as the format requires; dates, date and times and times are SAS days and seconds with their formats; text is blank-padded.
- **FR-002**: Variable names are at most eight characters (cut and made unique, case kept); text is cut at 200 bytes; variable labels at 40 bytes. Value labels are not written (SAS keeps them in a format catalog).
- **FR-003**: Read back with pyreadstat (`tests/unit/stat-write.test.ts`) and, in the browser, reopened by the app (`tests/e2e/stat-flow.spec.ts`).
- **FR-004**: A .sas7bdat upload is still written as a CSV by default, and offers every other type (a data set cannot be written).
- **FR-005**: The README for agents says what the file is and its limits.

## Assumptions

- Out of scope: transport version 8 (long names), SAS format catalogs, writing .sas7bdat.
