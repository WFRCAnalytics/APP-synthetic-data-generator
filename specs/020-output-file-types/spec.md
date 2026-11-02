# Feature Specification: Any upload as any file type

**Status**: Complete

Generate has a "File type" choice. The default is the same kind of file as the one opened (CSV, Excel, Parquet, JSON, or for SPSS and
Stata files the same kind of file again); every other file type the app writes is the other choice: CSV, Excel, Parquet, JSON, JSON Lines.

- **FR-001**: `retarget(spec, kind)` gives the spec a table has when it is written as another file type. It equals the spec of the same
  table designed for that file type, for every pair of types (`tests/unit/retarget.test.ts`).
- **FR-002**: The file name, the spec, the README for agents, the zip and the folder all follow the choice; the column summaries, rules, links and seed are untouched.
- **FR-003**: Nothing leaves the device.

Also in this slice: the privacy note is a dismissable announcement under the navbar (not remembered, since nothing is written to browser
storage), the file field is called "Data file", and the scrollbar and counter changes of the previous commits.

## Assumptions

- Out of scope: value labels in other formats, per-column choices of type, and workbook styling beyond number formats.
