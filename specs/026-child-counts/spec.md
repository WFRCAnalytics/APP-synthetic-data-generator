# Feature Specification: Counts that follow the other table

**Status**: Complete

Two tables whose ID columns match (specs/019) can now also agree on counts. A whole-number column of the first table (a household's
size) can be, for each ID, the number of rows the second table (the persons) has for that ID. On Review, the column's "Number of rows
in another table" takes the second table's saved spec and the ID column of it that uses this table's IDs.

- **FR-001**: For every ID, the column equals the number of rows of the other table that carry that ID; the counts add up to the other table's rows (checked on Generate, row "rows of the other table").
- **FR-002**: Both tables keep their own row counts: nothing is scaled. The other table's repeat structure and keyed placement give the counts, so no value is read.
- **FR-003**: The column replaces its own summary and has no missing values or sentinel codes; the ID column it follows holds one new ID per row, none missing; the other table draws from exactly this table's rows. A spec that breaks any of these is refused.
- **FR-004**: The two tables must be made with the seeds the link was made for. Accepting the link sets this table's seed to the one the other table was linked to, and says so.
- **FR-005**: The README for agents says what the column counts and that joining on the ID gives the same counts.

## Assumptions

- Out of scope: a count that follows a column that is not an ID, counts that scale a table's size, and cascades through three or more tables.
