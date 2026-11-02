# Feature Specification: File formats for designed tables

**Feature Branch**: `009-designed-table-formats` (spec directory only; work stays on `main`)

**Created**: 2026-11-02

**Status**: Draft

**Input**: User description: "Slice 9: a table designed from scratch can be written as an Excel workbook, a Parquet file, a JSON file or a file of one JSON record per line, as well as a CSV file. The person picks the file type in the table settings. Everything else about Start from scratch stays as it is: no real data is read, and the result is an ordinary spec."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Choose the file type of a designed table (Priority: P1)

An analyst designs a table from nothing (slice 6) and needs it as the kind of file their code reads: a workbook, Parquet, or
JSON. In the table settings they choose the file type: CSV (the default), Excel workbook, Parquet, JSON (a list of records)
or JSON Lines (one record per line). They continue to Review and Generate as before and download a fake file of that type,
named with the table name and `_fake`.

**Why this priority**: Designed tables were CSV only, while every file the app reads can be written in its own format.

**Independent Test**: Design a table with a column of each kind, pick each file type in turn, generate, download, and read the
file with an independent reader (a workbook reader, a Parquet reader, a JSON parser).

**Acceptance Scenarios**:

1. **Given** a design with a file type chosen, **When** the person continues to Review, **Then** the saved spec's source is
   that format and the file name has its extension.
2. **Given** each file type, **When** the person generates and downloads, **Then** the file opens in a reader of that format and
   holds the designed columns in order, with the designed number of rows.
3. **Given** a number column, **When** it is written to Excel, Parquet or JSON, **Then** it is a number there (a numeric cell,
   a numeric column, a JSON number), whole numbers are whole, and decimals have the designed decimal places.
4. **Given** a date column, **When** it is written to Excel or Parquet, **Then** it is a date there; in JSON it is text in the
   designed pattern.
5. **Given** a yes-or-no column, **When** it is written to JSON, **Then** it is `true` or `false` if its labels are a plain
   yes and no (or true and false), and text otherwise.
6. **Given** missing values in a column, **When** written to JSON, **Then** they are `null`; in Parquet they are nulls; in Excel
   they are blank cells.
7. **Given** the same design and seed, **When** generated twice, **Then** the files hold the same cells.

---

### User Story 2 - The choice is kept and explained (Priority: P2)

The chosen file type is part of the design, so going back to Design from Review keeps it, and a saved spec of a designed table
carries it. The table settings say what each type is in a short tooltip, and the Generate screen shows the real type (its
layout note says "a list of records" or "one record per line").

**Acceptance Scenarios**:

1. **Given** a design with Parquet chosen, **When** the person goes back from Review to Design, **Then** Parquet is still chosen.
2. **Given** a saved spec of a designed Parquet table, **When** it is loaded in a fresh session, **Then** it generates a Parquet
   file.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The table settings MUST offer the file types CSV, Excel workbook, Parquet, JSON and JSON Lines, with CSV the default.
- **FR-002**: The design MUST become an ordinary spec whose source is the chosen format, validated by the same validator as a
  loaded spec; no new spec version is needed.
- **FR-003**: The workbook MUST have one sheet named after the table (cut to the sheet-name rules), a header row, and number
  and date cells with number and date formats that match the design.
- **FR-004**: Each Parquet column MUST have a type that holds its designed values: a whole-number column the smallest signed
  integer width that holds its range, a decimal column a 64-bit float, a date a date, a moment a timestamp, and every other
  column a string; every column MAY hold missing values.
- **FR-005**: Each JSON key MUST be a number, text or true/false as described in User Story 1; JSON Lines MUST write one compact
  record per line and JSON a list of records indented by two spaces.
- **FR-006**: The file name MUST be the table name with the format's extension (`.csv`, `.xlsx`, `.parquet`, `.json`, `.ndjson`),
  and the export name follows the existing rule (`_fake` before the extension).
- **FR-007**: A table name MUST still be valid for the chosen format (for a workbook, the sheet name rules apply to it).
- **FR-008**: The choice MUST survive going back to Design and MUST be saved in the spec.
- **FR-009**: Nothing in this slice reads a real file, sends data anywhere or changes what a CSV design writes.
- **FR-010**: Older help text that says designed tables are CSV only MUST be updated.

### Key Entities

- **Output type**: One of CSV, Excel, Parquet, JSON, JSON Lines; part of a design.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a design with every column kind, each of the five file types generates a file that an independent reader opens
  and that holds the designed rows and columns, in each tested browser.
- **SC-002**: The CSV a design writes is byte-identical to what it wrote before this slice.
- **SC-003**: A person can change the file type and download in under 30 seconds from the table settings.
- **SC-004**: Zero outside requests, as for every other path.

## Assumptions

- A designed yes-or-no column keeps its labels as text unless they are a plain yes/no or true/false pair.
- Missing values in a JSON file are `null` (a key left out of a record is not offered for a designed table).
- Excel number formats are `0` for whole numbers and `0.00..` for decimals; date formats are `yyyy-mm-dd` and
  `yyyy-mm-dd hh:mm:ss`.
- Out of scope: JSON indent choices, Parquet compression choices, several sheets, and any change to Review beyond naming the
  real file type.
