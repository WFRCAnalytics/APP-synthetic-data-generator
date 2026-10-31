# Feature Specification: Personal Identifier, Free Text and Short String Columns

**Feature Branch**: `002-personal-text-columns`

**Created**: 2026-10-31

**Status**: Draft

**Input**: User description: "Slice 2: personal identifier columns, free text and short strings. Today these columns are detected as unsupported and left out of the fake file. Make them generate, without ever keeping a real value (SPEC.md privacy model, constitution Principle II)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Keep name, email, phone and address columns in the fake table (Priority: P1)

An analyst has a survey table with respondent name, email, phone and street address columns. In
slice 1 those columns are left out, so analysis code that reads them fails on the fake file. The
analyst opens the table, sees each such column proposed as a personal identifier of a specific
kind (full name, first name, last name, email, US phone, street address), confirms or changes the
kind, and generates. The fake file has the same columns, filled with invented but realistic values
in the same style, with the same number of distinct values and the same number of missing values.
No real value reaches the page, the spec or the output.

**Why this priority**: These are the most common columns that block slice 1 tables from being
usable. Without them an agent cannot run code that touches names, contacts or addresses.

**Independent Test**: Load a table with 50,000 distinct real names, an email column, a phone
column and an address column. Accept the proposed kinds, generate, and compare: the fake name
column has 50,000 distinct values and the same missing count as the real one, and none of the
fake values appears in the real file.

**Acceptance Scenarios**:

1. **Given** a column whose values look like email addresses, **When** profiling finishes, **Then**
   the card shows the kind "Email" with a plain-language explanation that values will be invented,
   and a live sample of invented emails.
2. **Given** a column the app proposes as "Full name" that the user knows holds last names only,
   **When** the user changes the kind to "Last name", **Then** the sample updates and the
   generated column holds invented last names.
3. **Given** a personal identifier column in which 1,000 distinct values appear once, 200 appear
   twice and 50 appear three times, **When** the user generates, **Then** the fake column has the
   same counts of values appearing once, twice and three times, and the check table shows a pass.
4. **Given** a personal identifier column with 3% blank and "NA" entries, **When** the user
   generates, **Then** the same number of rows is blank or "NA" in the fake column.
5. **Given** a column the user does not want in the fake file, **When** the user chooses "leave it
   out" or "keep as all-missing", **Then** the column is dropped or written as all-missing as in
   slice 1.

---

### User Story 2 - Keep free text columns with the right lengths (Priority: P2)

An analyst has a comments column with open-ended answers. The app proposes it as free text,
explains that only the lengths of the real answers are used, and generates filler text of similar
lengths. Code that truncates, counts words or checks for blanks behaves as it would on the real
file, and no real words are kept.

**Why this priority**: Free text is common in surveys, but analysis code rarely depends on its
content, only on its presence and length, so it matters less than the personal identifiers.

**Independent Test**: Load a table with a free-text column, generate, and confirm the fake
column's shortest, longest and median lengths match the real column and that no word of the real
text appears in the spec or the output.

**Acceptance Scenarios**:

1. **Given** a column of sentences of 3 to 400 characters, **When** the user generates, **Then**
   every fake value is between 3 and 400 characters, the shortest and longest equal the real ones,
   and the spread of lengths follows the real column.
2. **Given** a free text column, **When** the spec is saved, **Then** it holds only the kind, the
   length figures and the missing counts, with no word, phrase or sample from the real text.
3. **Given** a free text column with line breaks inside quoted values, **When** the fake CSV is
   written, **Then** line breaks inside values are quoted the same way as in the source file.

---

### User Story 3 - Keep short code-like strings without keeping their values (Priority: P2)

An analyst has columns of short strings with many distinct values that are not survey IDs, such
as a license plate, a postal code or a vendor code. The app proposes them as short strings,
generates strings of the same lengths and character styles (letters, digits, fixed separators),
and keeps the number of distinct values.

**Why this priority**: Without this, any high-variety text column is dropped. It completes the
set of string-like columns so a table no longer loses columns for being text.

**Independent Test**: Load a table with a short code column such as "AB-1234", generate, and
confirm that every fake value has the same length and character pattern as the real ones, the
distinct count matches, and no fake value equals a real one by design.

**Acceptance Scenarios**:

1. **Given** a column of codes shaped like two letters, a hyphen and four digits, **When** the user
   generates, **Then** every fake value has that shape and the check table shows the shape and
   length checks passing.
2. **Given** a short string column with mixed lengths from 4 to 9 characters, **When** the user
   generates, **Then** lengths follow the real spread and the shortest and longest match exactly.

---

### User Story 4 - Prove that nothing real is kept (Priority: P1)

The analyst, and their data owner, need to be sure that turning these columns on does not put
personal data into the spec, the page, the preview or the output. The existing privacy checks are
extended to the new column kinds, and fail the build if any real value appears anywhere.

**Why this priority**: These are the columns where a leak would harm real people. The feature is
not acceptable without this guarantee.

**Independent Test**: Run the privacy checks against the test table with personal columns: no
real name, email, phone, address, comment word or code appears in the page text, the saved spec,
the preview, the downloaded file or any error message.

**Acceptance Scenarios**:

1. **Given** a table with personal identifier, free text and short string columns, **When** a full
   session is run, **Then** no real value from those columns appears anywhere the app shows or
   saves.
2. **Given** the profiling step on such a table, **When** it finishes, **Then** only counts,
   lengths and shapes were taken from the data, and no real value was returned from the data
   engine for those columns.
3. **Given** a saved spec for such a table, **When** it is opened in a text editor, **Then** it is
   small, readable, and holds no value, word or sample from these columns.

---

### Edge Cases

- A column that mixes kinds (some emails, some plain text): the app flags it under "needs
  attention", proposes the commonest kind, and lets the user choose another kind or free text.
- A name column where one value appears in a very large share of rows (for example "Unknown"):
  the repeat structure keeps that share, and the generated repeated value is invented, not copied.
- More distinct values needed than the generator can invent (for example 5 million distinct last
  names): values are made unique by adding a short suffix, and a note tells the user so.
- Very long free text values (tens of thousands of characters): lengths are kept up to the
  longest real value; generation stays chunked so memory stays bounded.
- Non-English text, accents or emoji in a free text or name column: lengths are kept; the fake
  values use plain US English characters, and a note says so.
- Unique-by-row columns with 500 MB tables: profiling and generation stay within the slice 1
  time targets.
- Phone numbers in several formats within one column: the commonest format is proposed, and the
  mix is shown for confirmation.
- A personal column the user changes to a numeric or categorical type: this works as in slice 1,
  but the card warns that real labels would then be kept in the spec.
- Sentinel-like values (for example "refused") in a name column: they are kept as sentinels with
  exact counts, as in slice 1.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST propose a kind for each column that holds personal data: full name,
  first name, last name, email, US phone number, street address, URL, IP address, or a
  social-security-style number. The user MUST be able to confirm, change or exclude it.
- **FR-002**: Personal identifier columns MUST be generated with invented, realistic US English
  values of the chosen kind. No real value MUST appear in the output.
- **FR-003**: The fake column MUST keep the real column's repeat structure (how many distinct
  values appear once, twice, three times and so on) and its distinct count, without storing any
  value.
- **FR-004**: The fake column MUST keep the exact NA and sentinel counts, placed at random
  positions, as in slice 1.
- **FR-005**: The format of the real values MUST be kept where it matters to parsing: the commonest
  phone format, email shape and name style. A domain, name or number from the real data MUST NOT
  be copied.
- **FR-006**: The system MUST detect free text columns and generate filler text of the real
  column's length distribution (exact minimum and maximum, and the spread between them). No real
  word MUST be stored or output.
- **FR-007**: The system MUST detect short string columns (many distinct values that are not
  personal data and not survey IDs) and generate strings of the same lengths and character
  patterns (letters, digits, fixed characters), with the same distinct count.
- **FR-008**: Profiling MUST take only counts, lengths, shapes and uniqueness figures from these
  columns. No real value from them MUST be read into the page or returned by profiling.
- **FR-009**: The spec MUST store for these columns only the kind, repeat structure, length figures
  or shape, and NA and sentinel counts. It MUST NOT contain a value, word, phrase or sample from
  them. Loading a spec MUST reject any such column that carries one, naming the column.
- **FR-010**: Each card for these columns MUST show a plain-language explanation, a kind selector,
  and a live sample of invented values that updates when the kind changes.
- **FR-011**: Generation MUST be deterministic: the same spec and seed MUST produce the same
  values, and changing one column MUST NOT change another column.
- **FR-012**: The check table MUST include, for these columns, the distinct count, the repeat
  structure, the length minimum and maximum, and the NA and sentinel counts, each as target versus
  achieved.
- **FR-013**: When more distinct values are needed than can be invented naturally, the system MUST
  still deliver the exact distinct count by making values unique, and MUST tell the user.
- **FR-014**: The existing leak checks (page, spec, preview, output, error messages) MUST be
  extended to cover these column kinds and MUST fail if any real value appears.
- **FR-015**: The invented-value generator MUST work with no network request and MUST be loaded
  only where generation happens, so profiling never carries it. The added size MUST be recorded.
- **FR-016**: The change MUST keep the slice 1 time targets for a roughly 500 MB table.
- **FR-017**: Slice 1 specs (version 1) that mark these columns as unsupported MUST still load and
  work; the user can then switch them to a kind on Review.

### Key Entities

- **Personal identifier column**: A column of one kind (full name, first name, last name, email,
  US phone, street address, URL, IP address, social-security-style number) with a repeat
  structure, a distinct count, a format class and NA and sentinel counts. Holds no value.
- **Free text column**: A column described by a length distribution (minimum, maximum, spread)
  and NA and sentinel counts. Holds no word.
- **Short string column**: A column described by per-position character classes or a general
  pattern, a length distribution, a distinct count and NA and sentinel counts. Holds no value.
- **Invented sample**: A few made-up values shown on a card so the user can judge the kind. They
  are invented, so showing them is safe.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a table with 50,000 distinct names, the fake name column has exactly 50,000
  distinct values and exactly the real number of missing values.
- **SC-002**: Across all test tables, no real value from a personal identifier, free text or short
  string column appears in the page text, the saved spec, the preview, the exported file or any
  error message.
- **SC-003**: Generating twice with the same spec and seed gives byte-identical files, and
  changing one of these columns changes no other column.
- **SC-004**: For free text and short string columns, the fake minimum and maximum length equal the
  real ones, and the check table shows every exact metric as a pass.
- **SC-005**: A saved spec for a table with 50,000 distinct names stays under 100 kilobytes and
  under 1 megabyte for any table.
- **SC-006**: A roughly 500 MB, 120-column table that includes these column kinds still profiles
  in under 5 minutes and generates and exports in under 5 minutes on a reference office laptop.
- **SC-007**: The fake CSV parses with the same code as the real one, with identical column names,
  order and types, for tables containing these columns.
- **SC-008**: An analyst can confirm or change the kind of a personal column and see a sample in
  under 30 seconds.

## Assumptions

- Only US English values are invented in this version; other locales are later work.
- Columns are generated independently: a name column does not match an email column in the same
  row, as with all columns in slice 1.
- Invented values may coincide with real ones by chance for common names; the guarantee is that no
  real value is copied or stored, not that no coincidence exists.
- The invented-value generator is an existing open-source library already named in the project
  constitution, used only in the generating step.
- Latitude, longitude and other locales, cross-column consistency, Excel and Parquet remain out of
  scope, and stay in the deferred backlog.
- Slice 1 behavior for all other column types is unchanged.
