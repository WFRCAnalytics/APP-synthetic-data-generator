# Feature Specification: Linked IDs in a designed table

**Status**: Complete

A designed table's ID column can use the IDs of another table's ID column, as a table made from a file can (specs/019). In the column's
settings, "IDs from another table" takes the other table's saved spec and one of its ID columns; "Fewest rows per ID" and "Most rows
per ID" say how many rows share one ID.

- **FR-001**: The rows are shared out among IDs so that every ID has between the fewest and the most rows and the rows add up; the sizes are spread evenly across the range (`src/lib/design/repeat.ts`).
- **FR-002**: Every ID written exists in the other table. The table cannot need more distinct IDs than the other table makes; a range the rows cannot be shared out into is refused with the reason.
- **FR-003**: The spec holds the same link as any other (pattern, seed, column name, how many IDs); no ID value.

## Assumptions

- Out of scope: counts that follow the other table in a designed table, and linking columns that are not IDs.
