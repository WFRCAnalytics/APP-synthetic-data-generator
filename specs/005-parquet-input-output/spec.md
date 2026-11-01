# Feature Specification: Parquet input and output

**Feature Branch**: `005-parquet-input-output` (spec directory only; work stays on `main`)

**Created**: 2026-11-01

**Status**: Draft

**Input**: User description: "Slice 5: Parquet input and output. An analyst chooses a .parquet file, the app reads it in the browser with no download and no network, shows only structural metadata, profiles it like a CSV or an Excel sheet, and exports a fake .parquet with the same column names, order and logical types and a _fake suffix. The spec holds no cell values, no file metadata text and no statistics. Nested columns are marked unsupported. Compressed and dictionary-encoded files must read. Large files get a size warning."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Turn a Parquet file into a fake Parquet file (Priority: P1)

An analyst has a private survey table saved as a Parquet file (common when the data comes from R's
arrow, Python's pandas or a data warehouse export). They choose the file. The app shows its row
count, column count, column names and each column's type, and nothing from inside the table. It
profiles the file exactly as it does a CSV, the analyst reviews the columns, generates, and
downloads a fake `.parquet` with the same column names, the same order and the same logical types.
Code that reads the real file reads the fake one with no change.

**Why this priority**: Parquet keeps types exactly (integer width, decimal, date, timestamp), so it
is the most faithful format for analysis code. It is also what agents and data pipelines prefer.

**Independent Test**: Load a Parquet file that has integer, float, decimal, boolean, string, date and
timestamp columns, accept the defaults, generate and download. Read the real and the fake file with
the same code and compare column names, order and types.

**Acceptance Scenarios**:

1. **Given** a Parquet file, **When** the user chooses it, **Then** the app shows row count, column
   names, column types and the number of row groups, and shows no cell value.
2. **Given** a loaded file, **When** the user continues, **Then** it is profiled with the same
   column cards, types, review options and checks as a CSV.
3. **Given** a reviewed file and a seed, **When** the user generates, **Then** a preview of 50 fake
   rows and the check table are shown and a fake `.parquet` can be downloaded, named with `_fake`.
4. **Given** the downloaded file, **When** it is read with the same code as the real file, **Then**
   column names, order and logical types are identical, and string, number, date and timestamp
   columns hold values of the same kind.
5. **Given** the same spec and seed, **When** generated twice, **Then** the two files hold identical
   cell values.

---

### User Story 2 - Types that survive the round trip (Priority: P1)

The analyst's code depends on exact types: a 16-bit integer, a decimal with scale 2, a 32-bit float,
a timestamp with a time zone, a date. The fake file keeps these types, not just "number" and
"text". A column that was a decimal is a decimal in the fake file; an integer column that has
missing values stays an integer column that allows missing values.

**Why this priority**: Wrong types break downstream code silently (an ID column becoming a float, a
date becoming text). It is the main reason to support Parquet at all.

**Independent Test**: Load a file with one column of each supported type, generate, and compare the
schema of the real and fake files column by column.

**Acceptance Scenarios**:

1. **Given** columns of each supported type, **When** the fake file is written, **Then** each column
   has the same logical type, including integer width and signedness, decimal precision and scale,
   float width, date, timestamp unit and time zone flag, boolean and string.
2. **Given** a column with missing values, **When** the fake file is written, **Then** the column
   allows missing values and the number of missing values equals the recorded count.
3. **Given** a numeric column whose real values were whole numbers, **When** the fake file is
   written, **Then** it is not turned into floating point.
4. **Given** a generated value that does not fit the column's type (for example a decimal above its
   precision), **When** generating, **Then** it cannot happen: values are always kept inside the
   type's range, and the check table says if a range had to be narrowed.

---

### User Story 3 - Nested and unusual columns are handled safely (Priority: P2)

Some Parquet files hold lists, structures or maps in a column. Their contents are real values of
unknown shape. The app does not try to understand them: those columns are marked unsupported with a
plain reason, can be left out or kept as all-missing, and nothing from inside them is displayed,
flattened or stored.

**Why this priority**: Without a safe rule, nested data is the easiest place for real values to
leak into a spec or a preview. It must be refused rather than approximated.

**Independent Test**: Load a file with a list column, a struct column and a map column next to normal
columns; confirm the three are unsupported with a reason and the rest work.

**Acceptance Scenarios**:

1. **Given** a file with list, struct and map columns, **When** it is profiled, **Then** those columns
   are marked unsupported with a reason that names the kind (list, struct, map) and no value.
2. **Given** an unsupported column, **When** the user generates, **Then** it is left out of the fake
   file by default, or written as an all-missing column of the same logical name if the user keeps it.
3. **Given** the saved spec, **When** it is read, **Then** it holds the column name and the kind of
   nesting only, nothing from inside the column.

---

### User Story 4 - No real value and no file metadata leaves the file (Priority: P1)

A Parquet file carries more than rows: who created it and with what tool, free-text key-value
metadata (R and pandas store schema notes there), per-row-group minimum and maximum values,
dictionary pages and bloom filters. All of these can hold real values. None of them reaches the
page, the spec, the preview, the output file or an error message.

**Why this priority**: Parquet statistics are real cell values stored in the footer. Copying the
footer would defeat the tool's purpose.

**Independent Test**: Load a file whose key-value metadata and statistics hold marker strings and
numbers; run the whole flow; search the page, spec, preview, download, console and storage for the
markers and find none.

**Acceptance Scenarios**:

1. **Given** a file whose metadata and statistics contain marker values, **When** the whole flow is
   run, **Then** no marker appears on the page, in the spec, in the preview, in the downloaded file,
   in an error message, in the console or in browser storage.
2. **Given** the fake file, **When** its footer is read, **Then** its created-by names this app, its
   key-value metadata holds nothing from the real file, and its statistics (if any) describe fake
   values only.
3. **Given** a damaged, truncated or encrypted Parquet file, **When** it is chosen, **Then** the app
   refuses it with a plain message that quotes no file content.

---

### Edge Cases

- A file with no rows, or no columns: refused with a plain message.
- A very wide file (hundreds of columns) and a very tall one (many row groups): handled like a wide
  or tall CSV, with progress shown.
- A column whose name is empty, duplicated or not valid text: renamed on the same rules as CSV
  headers, and the rename is shown.
- A column of an unsupported scalar type (for example raw binary, an interval or a UUID): marked
  unsupported with a reason. Legacy 96-bit timestamps and enumerations are read as timestamps and
  text.
- A timestamp with a time zone: written with the same unit and time-zone flag; instants are fake.
- Dictionary-encoded columns: read like any column; the dictionary itself is never shown or kept.
- Compression (snappy, gzip, zstd, uncompressed): all read. The fake file uses a compression that
  every common reader supports and says which.
- A file larger than the stated limit: a size warning before profiling, as for CSV and Excel, and a
  stop above the memory the browser can hold.
- A folder of Parquet files (a partitioned dataset): not supported; the app says one file at a time.
- A Parquet file with the wrong extension, or a non-Parquet file named `.parquet`: detected by
  content and refused with a plain message.
- Loading a Parquet spec without the file: works for generating, as for CSV and Excel specs.
- A CSV or Excel spec still writes a CSV or an Excel file; a Parquet spec writes Parquet.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to choose a `.parquet` file; the file kind MUST be decided by its
  content, not its name.
- **FR-002**: Reading MUST happen in the browser with no download of a reader and no network
  request, under the same content policy and request counter as CSV and Excel.
- **FR-003**: After loading, the app MUST show only structure: row count, column count, column names,
  column types and the number of row groups. It MUST NOT show any cell value, statistic or metadata
  text from the file.
- **FR-004**: The file MUST be profiled like a CSV: the same column types (categorical, integer,
  decimal, boolean, date and time, ID, personal, free text, short string), cards, review options,
  checks and spec rules apply.
- **FR-005**: Each column's logical type in the file MUST be recorded in the spec as a type
  description only (kind, integer width and signedness, decimal precision and scale, float width,
  timestamp unit and time-zone flag, nullable), enough to write the same schema back.
- **FR-006**: The fake file MUST have the same column names, order and logical types as the real
  file, with values inside each type's range, and MUST allow missing values exactly where the real
  column had them.
- **FR-007**: Missing values MUST be real nulls in the fake file and their count MUST equal the
  recorded count; a column with no missing values MUST be written as required where the real one was.
- **FR-008**: Nested columns (list, struct, map) and scalar types with no safe fake MUST be marked
  unsupported with a reason that names the kind, MUST NOT be flattened, displayed or stored, and MUST
  be left out of the output unless the user keeps them as all-missing.
- **FR-009**: The spec MUST record a Parquet source (file name, row count, row-group count, and the
  per-column type descriptions) and MUST NOT hold any cell value, key-value metadata, created-by
  text of the real file, minimum or maximum from row-group statistics, dictionary content or bloom
  filter. Existing rules for what a spec may hold still apply.
- **FR-010**: The fake file's footer MUST name this app as its creator, MUST carry no key-value
  metadata from the real file, and MUST carry statistics only for fake values.
- **FR-011**: The file name MUST default to the original name with a `_fake` suffix and the extension
  `.parquet`, with the same keep-name option as the other formats.
- **FR-012**: A compressed or dictionary-encoded file MUST read; the fake file MUST use a compression
  readable by common tools and MUST state which in the Generate screen.
- **FR-013**: A file above a stated size MUST show a warning before profiling with the memory it
  needs; a file above the memory a browser tab can hold MUST be refused with a way forward.
- **FR-014**: Every generated value MUST be identical for the same spec and seed, and changing one
  column's settings MUST NOT change another column's values.
- **FR-015**: A damaged, truncated, encrypted, empty or non-Parquet file MUST be refused with a plain
  message that quotes no file content.
- **FR-016**: Loading a Parquet spec without the file MUST work for generating a Parquet file, and a
  CSV or Excel spec MUST keep producing its own format.
- **FR-017**: No real value, statistic or metadata text from the file MUST appear in the page, spec,
  preview, output file, error message, console or browser storage, in any browser the project tests.
- **FR-018**: Parquet MUST be available in the offline release with no extra file, and the offline
  copy MUST read and write it like the hosted site.

### Key Entities

- **Parquet source**: The file the user chose: name, row count, row-group count and one type
  description per column. Holds structure only.
- **Column type description**: Kind plus the details needed to write it back (width, signedness,
  precision, scale, unit, time-zone flag, nullable). Never a value.
- **Unsupported reason**: A short fixed text naming why a column cannot be faked (list, struct, map,
  unsupported scalar type).
- **Fake Parquet file**: The generated file: same schema, fake values, this app as creator, no
  metadata from the real file.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a file with every supported type, the real and fake files have the same column
  names, order and logical types when read by two independent readers.
- **SC-002**: No marker value planted in a file's data, key-value metadata, created-by text or
  statistics appears anywhere outside the real file, in 100% of automated runs in each tested browser.
- **SC-003**: The network counter shows zero outside requests after a full Parquet session, and no
  file other than the app's own is fetched.
- **SC-004**: Generating twice with the same spec and seed gives files with identical cell values.
- **SC-005**: A Parquet file whose data is about 500 MB once opened (the memory budget of a 500 MB CSV;
  the file itself is usually smaller) profiles and exports within the same time targets as an
  equivalent CSV, with the page staying responsive.
- **SC-006**: A saved Parquet spec stays under 1 megabyte and holds only the source structure and
  type descriptions.
- **SC-007**: Every unsupported or refused case ends in a plain message; none ends in a blank page,
  a crash or a partly written file.
- **SC-008**: An analyst can choose a Parquet file and reach the review screen in under 2 minutes
  without reading instructions.

## Assumptions

- The in-browser engine already reads Parquet without an extra download; the plan will confirm this
  under the strict content policy and the offline release before relying on it.
- The generation step has no access to the database engine (it works from the spec alone), so the
  plan decides how the Parquet bytes are written there; the result must meet the requirements
  above whichever way it is done.
- Common compression for the fake file is chosen by the plan (a widely readable one); the real
  file's compression is not copied.
- Column names and types follow the same rules as CSV once read: Parquet's richer types map onto the
  existing column types, and the type description is kept beside them for writing.
- Time zones and timestamps are handled as the same instants-kind data the date columns already
  support; fake instants do not reproduce real ones.
- Integers and decimals too large for exact arithmetic in the generators (beyond 2^53) are written
  exactly when they are converted, but values are generated inside a safe range of the column's
  type; the check table says when a range was narrowed.
- Out of scope: writing nested types, partitioned datasets (folders of Parquet files), Arrow and
  Feather, Delta and Iceberg, other locales, coordinates, folder output and multi-table.
