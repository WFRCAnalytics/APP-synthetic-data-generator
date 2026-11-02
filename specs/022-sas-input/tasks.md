# Tasks: SAS input

- [x] T001 `src/lib/stat/detect.ts` knows .sas7bdat and .xpt by their first bytes; `tests/unit/stat-detect.test.ts`
- [x] T002 SAS files are read only: the default output is CSV, no same-format choice
- [x] T003 Fixtures (`scripts/make-stat-fixtures.py`, the .sas7bdat from the stats_duck writer) and `tests/e2e/stat-flow.spec.ts`
