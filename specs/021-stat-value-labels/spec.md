# Feature Specification: Value labels from SPSS and Stata files

**Status**: Complete

SPSS and Stata files say what their codes mean (1 is Car). DuckDB's reader gives the codes but not the labels, so the app reads the
files' own label records (`src/lib/stat/labels.ts`) and keeps them beside the columns they belong to, the same way a codebook is kept
(specs/012): on Review, in the spec (`value_labels`) and in the README for agents. The fake file still holds the codes.

- **FR-001**: Only the label tables are read (an SPSS file's dictionary, a Stata file's label section); never the data.
- **FR-002**: A label is kept only for a column and a value the table really has; others are counted and dropped.
- **FR-003**: SPSS long variable names, labels shared by several variables, string variables, UTF-8 and Windows-1252 labels, and Stata 117, 118 and 119 files are read; older Stata files and anything unreadable give no labels, never an error.
- **FR-004**: Read against pyreadstat on files with several label sets, a shared set, a long name and an accented label (`tests/unit/stat-labels.test.ts`).
- **FR-005**: Nothing leaves the device.

## Assumptions

- Out of scope: variable labels, missing-value codes, writing labels into SPSS or Stata files, SAS formats.
