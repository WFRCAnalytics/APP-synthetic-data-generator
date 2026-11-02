# Slice 30: A category that follows the other table

A category (or yes/no) column of a table whose ID column uses another table's IDs can take its value from that table: in each row, the
value the other table's column has in the row with the same ID. A person's zone is the zone of their household.

- Review shows "Value from another table" on a category column when the table has such an ID column. The person chooses the other
  table's saved spec and one of its category columns.
- The other table's ID column must hold one new ID per row, none missing, and the other table's column must not be changed by a rule or
  follow a third table.
- The spec keeps the other table's seed, row count, ID column name and that column's labels and counts (which its own spec holds
  anyway). It holds no ID and no row.
- The check table says whether every value is one of the other table's. Joining the two tables on the ID gives the same value in both.
- The column has no missing values or sentinel codes of its own; the values come whole from the other table.
- "Make several tables at once" warns when the other table is not in the set.
