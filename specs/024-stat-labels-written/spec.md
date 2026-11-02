# Feature Specification: Labels written into SPSS and Stata files

**Status**: Complete

The fake SPSS and Stata files carry what the table says its columns mean: each column's description becomes the file's variable
label, and the value labels of a number column become the file's value labels (the codes stay as they are). A file opened,
written and opened again keeps its codebook.

- **FR-001**: Variable labels: at most 120 bytes in SPSS, 80 characters in Stata.
- **FR-002**: Value labels: only for columns written as numbers; whole numbers within four bytes for Stata; at most 120 bytes each and 2,000 per column. Text columns carry none (SPSS allows them only for very short text).
- **FR-003**: Read back with pyreadstat for both formats (`tests/unit/stat-write.test.ts`) and reopened in the app (`tests/e2e/stat-flow.spec.ts`).
- **FR-004**: The README for agents says the labels are written.

Also: the Help guide says what the app does today (file types in and out, the zip and folder, what the spec holds including labels and ID links).
