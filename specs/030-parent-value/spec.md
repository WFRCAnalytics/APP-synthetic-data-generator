# Slice 30: A column that follows the other table

A category, yes/no, number or date column of a table whose ID column uses another table's IDs can take its value from that table: in each row, the
value the other table's column has in the row with the same ID. A person's zone is the zone of their household.

- Review shows "Value from another table" on such a column when the table has such an ID column. The person chooses the other
  table's saved spec and one of its columns of the same kind (a number follows a number, a date a date).
- The other table's ID column must hold one new ID per row, none missing, and the other table's column must not be changed by a rule.
- The other table's column may itself follow a third table (a trip's zone through its person to their household). The spec then also
  keeps how that column does so, as structure only, and the chain can be up to six tables long.
- The spec keeps the other table's seed, row count, ID column name and that column's own spec (a summary its own spec holds anyway).
  It holds no ID and no row. Nothing in it is specific to one kind of survey: any two tables joined by an ID can use it.
- The check table says whether every value is one of the other table's. Joining the two tables on the ID gives the same value in both.
- The column has no missing values or sentinel codes of its own; the values come whole from the other table.
- "Make several tables at once" warns when the other table is not in the set.
