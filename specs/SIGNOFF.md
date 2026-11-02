# Sign-offs that need a person

The automated checks cover everything in the specs except the criteria below. Each one is a person using the app (or the offline zip)
without help, with a stopwatch. They cannot be run by a script. Record the result next to the criterion (initials, date, time taken).
The same app can be tried on the hosted page, https://wfrcanalytics.github.io/APP-synthetic-data-generator/.

Use any of the files in `tests/fixtures/` for a "typical table" (`zoo/zoo_small.csv` has 88 columns; `zoo_wide` style files are made by
`scripts/make-fixtures.mjs`).

| Spec | Criterion | How to try it | Result |
| --- | --- | --- | --- |
| 001 SC-007 | From loading a typical table to a downloaded fake CSV in under 10 minutes, accepting most detected defaults. | Open a CSV, accept the settings, Review, Generate, download. | [ ] |
| 001 SC-008 | In a table with 120 columns, find and open any single column's card in under 15 seconds using search or filters. | Open a 120-column CSV; ask the person to open three named columns. | [ ] |
| 002 SC-008 | Confirm or change the kind of a personal column and see a sample in under 30 seconds. | Open a CSV with a name or email column; change its kind. | [ ] |
| 003 SC-008 | Choose a workbook, pick a sheet and reach Review in under a minute. | Open a typical `.xlsx`. | [ ] |
| 004 SC-008 | Following `README.txt` on a clean Windows machine, in each supported browser, reaches a working app. Someone other than the author. | Unzip the release on a machine that has never had the app; follow the README only. | [ ] |
| 005 SC-008 | Choose a Parquet file and reach Review in under 2 minutes without reading instructions. | Open a `.parquet` file. | [ ] |
| 006 SC-001 | A person who has never seen the app designs a five-column table and downloads a file in under 5 minutes without instructions. | Start from scratch; five columns; download. | [ ] |
| 007 SC-009 | Choose a JSON file and reach Review in under 2 minutes without reading instructions. | Open a `.json` or `.ndjson` file. | [ ] |

Later slices (SPSS, Stata, SAS, linked tables, several tables at once) have no timed criterion; their checks are automated.

Signed off by: ______________________  Date: ____________
