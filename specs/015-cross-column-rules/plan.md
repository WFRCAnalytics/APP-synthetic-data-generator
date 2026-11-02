# Implementation Plan: Rules between columns

**Spec**: [spec.md](spec.md)

## Summary

`src/lib/rules/types.ts` (the three rule kinds, `describeRule`) and `apply.ts` (`applyRules` wraps a target column generator so its
value in a row comes from the source generator's value for the same row; generators depend only on seed, column and row, so any row
can be asked for). `planTable` applies the rules after the columns are made; a source left out of the file is made on the side.
The validator refuses a rule that does not fit; `CheckAccumulator` skips the changed column's own summaries and checks each rule on
the written text. The session keeps the rules, the spec builder writes the ones whose columns are still in the table, Review's
overview has a `RulesPanel`, and the README lists them.

## Constitution Check

Reproducibility: rules are pure functions of seed, column and row, so output does not depend on chunk size or column order. Exact
summaries: a changed column is replaced by its rule, which the check table verifies instead. Privacy and minimal artifact: a rule is
a statement the person typed; the spec gains no value from the data.
