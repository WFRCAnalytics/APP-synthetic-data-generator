# Feature Specification: Rules between columns

**Feature Branch**: `015-cross-column-rules` (spec directory only; work stays on `main`)

**Created**: 2026-11-02

**Status**: Complete

**Input**: User description: "Cross-column rules: every column was generated on its own, so an end date could come before its start date, or an unlicensed driver have a car. Let the person state relations between columns that hold in every row: one column comes after another, is blank when another is blank, or has a set value when another has a value."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - State a relation, and it holds in every row (Priority: P1)

On the Review overview, "Rules between columns" lists the rules and offers "Add a rule". The person chooses the kind of rule, the
column that changes and the column it depends on, and any numbers. Three kinds exist: a column comes after another by a gap (days for
a date, seconds for a date and time or a time, units for a number); a column is blank when another is blank; a column has a set
value when another has a value (two category or yes-or-no columns). A rule that does not fit the table is refused with the reason.
The fake file obeys every rule in every row, the check table has a row for each rule saying so, and the spec and the README for
agents state the rules.

**Independent Test**: A table with a start date and an end date; the rule "end comes 3 to 9 after start" makes every row's gap 3
to 9 days, blank where the start is blank, and the check table says it holds in all rows.

**Acceptance Scenarios**:

1. **Given** a follows rule, **When** the file is made, **Then** the target is the source plus a gap inside the range in every row,
   and blank where the source is blank.
2. **Given** a blank-with rule, **When** the file is made, **Then** the target is blank wherever the source is blank.
3. **Given** a set-when rule, **When** the file is made, **Then** the target holds the set value wherever the source holds the value.
4. **Given** a rule, **When** the other columns are looked at, **Then** they are exactly what they were without it, and the same spec
   and seed give the same bytes whatever the chunk size.
5. **Given** a rule that names a missing column, a column of the wrong type, a value the column does not hold, itself, a column
   another rule uses or changes, or a target that already has a rule, **When** it is added or loaded, **Then** it is refused.
6. **Given** the check table, **When** a rule holds in every row, **Then** its row says so; the summaries of the changed column
   are not checked, because the rule replaces them.

## Requirements *(mandatory)*

- **FR-001**: The spec MUST record rules as plain statements (`rules`), at most 100, never learned from data.
- **FR-002**: A rule MUST hold in every written row, whatever the seed, chunk size or file type.
- **FR-003**: Rules MUST NOT chain: a column that a rule changes cannot be used by another, and a column has at most one rule.
- **FR-004**: A rule MUST be refused with a plain message when it does not fit the table.
- **FR-005**: The check table MUST check each rule on the written text and say how many rows break it.
- **FR-006**: The README for agents MUST list the rules.
- **FR-007**: No spec version change is needed (`rules` is optional).

## Success Criteria

- **SC-001**: For each rule kind, no row of the generated file breaks it, and the check row says so.
- **SC-002**: Output of columns a rule does not touch is identical with and without the rule.
- **SC-003**: Zero outside requests.

## Assumptions

- A column a rule changes keeps its own summary in the spec but it is no longer measured.
- Out of scope: rules with several sources, arithmetic on several columns, rules inferred from the data, and rules inside a design.
