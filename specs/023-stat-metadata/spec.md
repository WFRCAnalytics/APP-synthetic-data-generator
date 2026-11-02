# Feature Specification: Missing codes and variable labels from SPSS, Stata and SAS files

**Status**: Complete

- **Declared missing codes.** An SPSS file can declare codes such as 98 and 99, or 90 to 99, as missing. The reader already turns them
  into blanks, so they count as missing values here; the summary says which variables declare codes and which (read from the file's
  own dictionary, `src/lib/stat/labels.ts`). Stata and SAS missing values are blanks to the reader and need no note.
- **Variable labels.** `read_stat_metadata` gives what each variable means ("Household"). It is kept as the column's `description`
  (one line, at most 200 characters): shown under the column's name on Review, in the saved spec, and as a "Meaning" column in the README for agents.

- **FR-001**: Only structure and metadata are read; no value is shown; errors are fixed messages.
- **FR-002**: `description` is documentation: it never changes what is generated.
- **FR-003**: A description of more than 200 characters or an empty one is refused in a spec.

## Assumptions

- Out of scope: writing descriptions into SPSS, Stata or SAS files (see specs/024), restoring the declared codes as sentinel codes (their rows are already blanks to the reader).
