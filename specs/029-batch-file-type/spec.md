# Slice 29: A file type for the whole set

"Make several tables at once" has a File type choice. The default, "As each spec says", writes every table as its spec's own type.
Any other choice writes every table as that type: CSV, Excel, Parquet, JSON, NDJSON, or an SPSS, Stata or SAS transport file.

- The tables are made from the same specs and seeds as before, so the rows are the same whatever the type.
- The spec saved beside each file is the spec of that type (as when one table is made with that choice); the README names it.
- SPSS, Stata and SAS transport files are written from a finished CSV run, with the variable labels and value labels of the spec.
  Text longer than the type allows is cut, and the table says how many values were cut.
- Changing the type clears the results; the tables are made again.
