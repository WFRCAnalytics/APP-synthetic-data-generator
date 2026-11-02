# Tasks: Rules between columns

- [x] T001 `src/lib/rules/types.ts` and `apply.ts`; `tests/unit/rules.test.ts` (follows, blank_with, set_when, determinism, other columns unchanged)
- [x] T002 `rules` in the spec, its validation (names, types, values, no chains, one rule per column) and the builder
- [x] T003 The check table verifies each rule and skips the changed column's own summaries
- [x] T004 Session state, `addRule` and `removeRule`; `RulesPanel` on the Review overview
- [x] T005 The README for agents lists the rules
- [x] T006 End-to-end: a follows rule holds in every row, shows in the check table, the spec and the README (`tests/e2e/review.spec.ts`)
- [x] T007 Converge: nothing outstanding
