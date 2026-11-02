# Tasks: File formats for designed tables

## Phase 1: Library

- [x] T001 [US1] Tests first in `tests/unit/design-build.test.ts`: for every design kind and each output type the spec validates, has the right source and file extension, and carries the per-column description (workbook formats, Parquet types, JSON kinds); a CSV design is unchanged
- [x] T002 [US1] `src/lib/design/types.ts`, `defaults.ts`, `validate.ts`: `output` on a design (default csv), the workbook sheet-name rule for the table name
- [x] T003 [US1] `src/lib/design/build.ts`: the source per output type and the per-column fields (cell formats, `parquet_type`, `json_kind`)
- [x] T004 [US1] Writer round trips in `tests/integration/design-formats.test.ts`: generate a designed table in each format and read it back (cells, kinds, rows, missing values), same bytes for the same seed

## Phase 2: Screen

- [x] T005 [US1][US2] `DesignScreen.tsx`: File type select with a tooltip in Table settings, the file-name hint follows it, the choice survives going back; component tests
- [x] T006 [P] [US1] `tests/e2e/design-flow.spec.ts`: choose each file type, generate, download, read it back, and a spec round trip for Parquet

## Phase 3: Polish

- [x] T007 [P] Help guide, README and the designed-table banner say that a designed table can be written in each format
- [ ] T008 Run the browser matrix and the offline zip; record results in `research.md`
- [ ] T009 Run `/speckit-converge` and mark the slice complete
