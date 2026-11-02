# Feature Specification: Tables that join

**Status**: Complete

Each table is still made on its own, but a survey ID column can now use the IDs of another table's ID column, so a join between two
separately generated fake tables finds every row (a household table and a persons table, a trips table and a persons table).

**Review**: on an ID column, "IDs from another table" takes the other table's saved spec and one of its ID columns. Only the pattern,
the seed, the column's name and how many IDs it makes are copied (`link` in the spec); no ID value is read or shown.

- **FR-001**: Every ID this column writes is one the other table's column writes (when that table is generated from the same spec and seed).
- **FR-002**: The column keeps its own repeat structure (how many rows share an ID); its distinct IDs map one to one onto distinct IDs of the other table, so no two share one.
- **FR-003**: A link is refused when the column has more distinct IDs than the other column makes, or the other pattern cannot hold them.
- **FR-004**: The spec holds no ID value; the README for agents says which table's IDs the column uses and with which seed.
- **FR-005**: Output of every other column is unchanged, and the same spec and seed give the same bytes whatever the chunk size.

## Assumptions

- Out of scope: linking columns that are not survey IDs, several tables in one session, cascades (a child count that follows the parent's), and links inside a design.
