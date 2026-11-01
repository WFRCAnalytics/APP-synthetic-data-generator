# Feature Specification: Start from scratch

**Feature Branch**: `main` (slice 6)
**Created**: 2026-11-01
**Status**: Draft
**Input**: "What if someone wants to generate fake data from scratch?" A person with no real file (a new survey, a teaching example, a test table for a tool) designs a table in the browser and downloads fake data for it.

## User Scenarios & Testing

### User Story 1 - Design a table and download fake data (Priority: P1)

An analyst opens the app, chooses "Start from scratch", names the table, says how many rows they want, adds columns one by one (a whole number between 1 and 5, a category with weights, a date range, an ID, a person's name, a Yes/No), and reaches the same Review and Generate screens as for a file. They download a fake file in the format they pick.

**Why this priority**: it is the whole feature. Without it the app only works when real data already exists.

**Independent Test**: from the first screen, design a four-column table with 500 rows, generate it, and open the download: it has the four columns with the chosen names and order, 500 rows, and every value inside the range or label set the person set.

**Acceptance Scenarios**:

1. **Given** the first screen, **When** the person chooses "Start from scratch", **Then** a design screen opens with an empty table and one clear action to add the first column.
2. **Given** a design with columns, **When** the person continues, **Then** Review lists those columns with the same settings as for a file, and Generate produces a file.
3. **Given** a generated file, **When** the person goes back to Design and changes a column, **Then** Review and Generate follow the change and earlier edits on other columns are kept.
4. **Given** a design, **When** the person saves the spec, **Then** loading that spec later gives the same table (it is an ordinary spec file).

### User Story 2 - Describe each kind of column in plain terms (Priority: P1)

Each kind of column asks only for what a person can say without data: a number asks for the smallest, the largest and whether values spread evenly or cluster around a typical value; a category asks for its labels and how common each is; a date asks for the first and last day; an ID asks for a prefix and how many digits; a personal column asks which kind (names, emails, phone numbers); a Yes/No asks how often "Yes" should come up. Every kind also asks how often the value should be missing.

**Independent Test**: for each kind, fill the form, generate, and check the downloaded values against the stated limits and shares (within the tolerances the check table already uses).

**Acceptance Scenarios**:

1. **Given** a number column from 18 to 90 that clusters around 40, **When** generated, **Then** every value lies between 18 and 90 and the mean is close to 40.
2. **Given** a category with labels "Bus 50, Rail 30, Walk 20", **When** generated, **Then** the shares are close to 50, 30 and 20 percent.
3. **Given** a column that is 5 percent missing, **When** generated, **Then** about 5 percent of the cells are blank.
4. **Given** a form with a problem (a largest value below the smallest, two columns with one name, no labels), **Then** the problem is said next to the field in words, and the person cannot continue until it is fixed.

### User Story 3 - Add many columns quickly (Priority: P2)

A person who wants 30 columns can duplicate a column, paste a list of names to create several columns of one kind at once, and reorder columns.

**Acceptance Scenarios**:

1. **Given** a column, **When** the person duplicates it, **Then** a copy with a new name appears next to it and is selected.
2. **Given** a pasted list of names (one per line), **When** the person adds them as "whole numbers", **Then** one column per name is created with the default settings of that kind.
3. **Given** a long list, **Then** the same search, type filter and keyboard movement as on Review work in the design list.

## Requirements

- **FR-001**: The first screen offers three ways in: choose a file, open a saved spec, start from scratch. Each says in one line what it does.
- **FR-002**: A design holds a table name (the file name stem), a row count (1 to 10,000,000), a seed, and an ordered list of columns.
- **FR-003**: The kinds of column are: whole number, decimal number, category, Yes/No, date, date and time, ID, personal (names, emails, phone numbers, street addresses), and free text length. Each kind has defaults, so a column works the moment it is added.
- **FR-004**: Every column has a name that is not blank, is unique in the table, and a missing-value rate from 0 to 100 percent.
- **FR-005**: A design becomes an ordinary spec (the same file format and validation as a spec saved after profiling a file); nothing downstream of the spec knows the table was designed.
- **FR-006**: The spec of a designed table is an ordinary CSV spec (comma, UTF-8, header row), so it needs no new spec version. It holds no real data by construction. Review says that the table is designed, not read from a file, and does not offer to read a source file.
- **FR-007**: Review of a designed table can change the settings that need no data (rename, leave out, rounding, optional protections, ID patterns, personal kind). Settings that need the data (re-detecting a type, sentinel codes, missing-value markers read from data) are not offered, and the screen says to change them in Design.
- **FR-008**: The output is a CSV file. Excel and Parquet output for a designed table need per-column formats that Design does not ask for and are a later slice.
- **FR-009**: Leaving Design with problems is blocked; leaving it with no columns is blocked, with a message that says to add one.
- **FR-010**: Going back to Design from Review or Generate keeps the design; "Start over" clears it.
- **FR-011**: The design is held in memory only. Nothing is stored in the browser, nothing is sent anywhere.
- **FR-012**: The Design screen is operable by keyboard and passes the same accessibility checks as the other screens, in light and dark themes.

## Success Criteria

- **SC-001**: A person who has never seen the app designs a five-column table and downloads a file in under 5 minutes without instructions (person sign-off).
- **SC-002**: For every kind of column, 100 percent of generated values respect the limits set in Design, and category shares and missing rates are within the existing check-table tolerances.
- **SC-003**: A designed table of 100 columns and 100,000 rows generates in the same time as a profiled file of that size, plus no more than one second of design overhead.
- **SC-004**: A spec saved from a designed table loads in a fresh session to the identical table, and generating both with one seed gives byte-identical files.
- **SC-005**: No request leaves the page, no browser storage is written, and the console stays clean, in all four browsers.

## Assumptions

- The existing generator already produces correct fake values from a spec of summaries; this slice builds specs from a person's description instead of from data.
- A bell-shaped number uses the quantile form the spec already carries (101 values), computed from the stated smallest, largest, typical value and spread.
- A designed table has no sentinel codes, no cell formats and no Parquet logical types beyond the default for each kind.

## Out of Scope

- Relationships between columns (an end date after a start date, a total that adds up), several tables, and importing a codebook: later slices.
- Coordinates and other locales.
