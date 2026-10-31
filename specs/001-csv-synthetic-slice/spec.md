# Feature Specification: CSV Synthetic Data Slice

**Feature Branch**: `001-csv-synthetic-slice`

**Created**: 2026-10-30

**Status**: Draft

**Input**: User description: "Build the first vertical slice of the WFRC Synthetic Data Generator (design source: SPEC.md): CSV in, profile and review, save/load spec JSON, generate, CSV out, for categorical, numeric, date/time and survey ID columns, with WFRC-branded app shell, stepper, local-processing notice and network-request counter."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Turn a private CSV into a fake CSV (Priority: P1)

A travel-survey analyst has a private trip table as a CSV. They open the app, choose the file,
confirm the detected file settings, review how each column was understood, set a seed, and
download a fake CSV with the same columns, row count, formats and summary figures. They place it
in a mirror project folder so an AI coding agent can work against it, then later swap in the real
file unchanged.

**Why this priority**: This is the whole product promise in one pass. Without it, nothing else
delivers value.

**Independent Test**: Load a CSV containing categorical, numeric, date and ID columns, accept
all defaults, generate, and download. Confirm the fake file has the same header, row count and
formats, and that the same analysis script runs on both files.

**Acceptance Scenarios**:

1. **Given** a CSV with a header row, **When** the user selects it, **Then** the app shows the
   detected delimiter, encoding, quote character and header setting for confirmation, plus the
   row count, column count and column names, and shows no row values.
2. **Given** confirmed settings, **When** profiling finishes, **Then** every column has a card
   with a detected type and summary, and the user can continue to generation.
3. **Given** a reviewed table and a seed, **When** the user generates, **Then** a preview of the
   first 50 fake rows and a check table are shown, and the user can export the fake CSV.
4. **Given** the exported fake CSV, **When** the same parsing code used for the real CSV is run
   on it, **Then** it parses with identical column names, order and types.

---

### User Story 2 - Review and override every column decision (Priority: P1)

Before anything is generated, the analyst reviews one card per column and corrects any wrong
guess: changes a type, confirms sentinel codes such as -9 or 998, edits NA tokens, picks how
numbers are matched, sets decimals, excludes a column, or turns on optional protections.

**Why this priority**: Detection is heuristic, and the analyst knows their codebook. Without
this step, generated data would be wrong in ways that break the agent's code.

**Independent Test**: Load a table with a coded integer column (mode: 1, 2, 3, 97), a numeric
column with sentinels, and a column the profiler is unsure about. Override each decision and
confirm generation honors the override.

**Acceptance Scenarios**:

1. **Given** an integer column holding a small set of codes, **When** profiling completes,
   **Then** it is typed as categorical, not numeric.
2. **Given** a numeric column with values such as -9 and 998 flagged as likely sentinels,
   **When** the user confirms or edits them, **Then** their exact counts are kept and they are
   excluded from the column's min, max, mean and standard deviation.
3. **Given** a table with 100 or more columns, **When** the user types in the search box or
   picks the "needs attention" or a type filter, **Then** the list narrows to matching columns
   and a banner lists the columns the profiler was unsure about.
4. **Given** the optional protections, **When** the user first opens Review, **Then**
   category merging, label replacement and column renaming are all off.
5. **Given** a column the user excludes, **When** the fake table is exported, **Then** it is
   dropped by default, or kept as all-NA if the user chose that option.

---

### User Story 3 - Describe survey IDs by pattern, never by list (Priority: P1)

The table has IDs such as `UT-102-884` or `1023402`. The app infers a pattern (each character
position is a digit, a letter or a fixed literal, plus length), shows it in a small editor with
a live sample of generated values, and lets the user adjust it. No real ID values are saved
anywhere, even for tables with tens of thousands of IDs.

**Why this priority**: IDs appear in nearly every survey table, and the privacy model forbids
storing them. This is the one place a naive design would leak the most.

**Independent Test**: Load a table with 50,000 household IDs, save the spec, and confirm the
spec holds no ID values, and that generated IDs fit the pattern and the repeat structure.

**Acceptance Scenarios**:

1. **Given** an ID column like `UT-102-884`, **When** profiled, **Then** the mask shows two
   letters, a literal hyphen, three digits, a hyphen and three digits.
2. **Given** an ID mask the user edits, **When** the edit is made, **Then** a live sample of
   generated values updates immediately.
3. **Given** household IDs that each repeat 2.4 times on average, **When** generated, **Then**
   the fake column has the same count of IDs appearing once, twice, three times and so on.
4. **Given** a saved spec, **When** it is opened in a text editor, **Then** it contains no list
   of ID values.

---

### User Story 4 - Save a spec, reload it later, and reproduce output (Priority: P2)

The analyst saves the reviewed settings as a small, readable spec file. Later, with the same
file or a new seed, they load the spec to skip profiling and regenerate. The same seed always
produces the same fake data.

**Why this priority**: It saves repeated review work and lets users audit exactly what was
taken from the real data.

**Independent Test**: Save a spec, reload the page, load the spec, generate with the same seed
twice, and confirm the two outputs are identical. Edit one column in the spec by hand and
confirm only that column's output changes.

**Acceptance Scenarios**:

1. **Given** a reviewed table, **When** the user saves the spec, **Then** a readable file is
   downloaded that contains only category labels, min and max, sentinel codes, quantiles,
   masks and repeat structures, and a spec version number.
2. **Given** a saved spec, **When** the user loads it, **Then** the app skips ingest and
   profiling and goes straight to Review with all settings restored.
3. **Given** a hand-edited spec with a bad value, **When** it is loaded, **Then** the app
   reports the problem by column name and does not proceed with the bad column.
4. **Given** the same spec and seed, **When** generated twice, **Then** the outputs are
   byte-identical; **and** changing one column's settings leaves every other column unchanged.

---

### User Story 5 - Trust that nothing leaves the device (Priority: P1)

The analyst, or their data-governance reviewer, wants proof that the data stays local. The app
shows a persistent notice, and a visible counter of network requests since page load, split
into same-origin and cross-origin.

**Why this priority**: The privacy claim is the product's reason to exist, and it must be
checkable without opening developer tools.

**Independent Test**: Load a CSV, profile, generate and export, then read the counter. The
cross-origin count is zero.

**Acceptance Scenarios**:

1. **Given** the app on any step, **When** the user looks at the page, **Then** a notice states
   data is processed locally and that reloading clears it.
2. **Given** a full session from ingest to export, **When** the user reads the counter,
   **Then** it shows zero cross-origin requests.
3. **Given** a session in progress, **When** the page is reloaded, **Then** all real data is
   gone from memory and the app returns to the start.

---

### User Story 6 - Work with large, wide tables (Priority: P2)

Household survey tables can reach about 500 MB and 100 to 120 or more columns. The analyst
loads one without the browser tab freezing, sees progress, and can find any column quickly.

**Why this priority**: Real tables are large and wide, and an unresponsive app will be
abandoned.

**Independent Test**: Load a roughly 500 MB CSV and watch for progress through profiling,
generation and export without a frozen tab.

**Acceptance Scenarios**:

1. **Given** a very large CSV, **When** profiling runs, **Then** a progress indicator is shown
   and the page stays responsive.
2. **Given** a very large table, **When** the fake table is generated and exported, **Then**
   progress is shown and the export completes.
3. **Given** a browser that cannot write into a chosen folder, **When** the user exports,
   **Then** the file downloads as a single file.

---

### Edge Cases

- A CSV with no header row, a byte-order mark, a non-comma delimiter, a non-UTF-8 encoding, or
  quoted fields that contain delimiters and line breaks.
- Ragged rows, or a file the app cannot parse: the user sees a clear message, and no row data
  is shown in it.
- A column where every value is NA, or a column with a single distinct value.
- A numeric column where all non-sentinel values are identical (zero standard deviation).
- A numeric column with only one non-sentinel value, or none.
- A coded integer column that sits just above or just below the categorical threshold.
- A column with leading zeros (such as ZIP codes), thousands separators, or mixed NA tokens.
- Dates in more than one format within a single column: the column is flagged for review
  instead of silently guessed.
- An ID column that is unique per row, one that repeats in groups, and one with mixed masks.
- Rare categories, such as a label that appears once, when merging is off.
- A spec whose column list no longer matches the loaded file, or a spec from a newer or older
  version.
- A seed left blank, or a seed outside the allowed range.
- Rounding that moves a generated mean or standard deviation away from its target.
- A browser tab closed in the middle of profiling or generation.

## Requirements *(mandatory)*

### Functional Requirements

**Ingest**

- **FR-001**: Users MUST be able to choose a CSV file of up to about 500 MB and 100 to 120 or
  more columns.
- **FR-002**: The system MUST detect the delimiter, encoding, quote character and header
  presence, show them for confirmation, and let the user change each.
- **FR-003**: The system MUST show row count, column count and column names after load, and
  MUST NOT show any row values anywhere in the app.
- **FR-004**: Users MUST be able to load an existing spec instead of a data file, and skip
  profiling.

**Profile and review**

- **FR-005**: The system MUST assign each column one type from: boolean, categorical,
  integer, float, date, datetime, time, survey ID, or empty, using the first matching rule in
  the order set out in SPEC.md, and MUST allow the user to override it.
- **FR-006**: Integer columns with 50 or fewer distinct values MUST default to categorical, and
  the threshold MUST be adjustable.
- **FR-007**: The system MUST flag likely sentinel codes for the user to confirm or edit, keep
  their exact counts, and exclude them from min, max, mean and standard deviation.
- **FR-008**: The system MUST record the NA tokens used per column, and let the user edit them.
- **FR-009**: The system MUST show one card per column with name, type, summary (counts,
  min and max, mean and standard deviation, NA and sentinel counts) and a small chart drawn
  from the summary.
- **FR-010**: The system MUST provide search, a "needs attention" filter and a filter by type,
  and a banner naming columns the profiler was unsure about.
- **FR-011**: Users MUST be able to choose per numeric column one of three modes (uniform,
  match mean and standard deviation, match shape) and set decimal places or integer rounding.
- **FR-012**: Users MUST be able to exclude a column, and the system MUST by default drop it
  from the output, with an option to keep it as all-NA.
- **FR-013**: The system MUST offer three optional protections, all off by default: merge
  categories with fewer than k rows into "Other", replace category labels with neutral codes,
  and rename columns.

**Survey IDs**

- **FR-014**: The system MUST infer for each ID column a pattern mask (digit, letter or fixed
  literal per character position, plus length), optional min and max for numeric IDs, and a
  repeat structure (how many distinct IDs appear once, twice, and so on).
- **FR-015**: The system MUST NOT store, save or export any list of real ID values.
- **FR-016**: Users MUST be able to edit the mask in a token editor and see a live sample of
  generated values.

**Spec**

- **FR-017**: Users MUST be able to save the reviewed settings as a spec file that holds a
  spec version number and only: category labels and counts, min and max, sentinel codes,
  quantiles, masks, repeat structures, and format settings.
- **FR-018**: The system MUST validate a loaded spec and report each problem by column name.
- **FR-019**: The spec MUST be readable and editable by hand, and MUST NOT contain free text,
  personal identifiers, coordinates, or ID value lists.

**Generate**

- **FR-020**: Users MUST be able to set a seed. The same spec and seed MUST always produce the
  same output.
- **FR-021**: Each column MUST use its own sub-seed derived from the seed and the column name,
  so changing one column's settings never changes another column's output.
- **FR-022**: For every column, NA and sentinel rows MUST be placed at random positions with
  their exact counts.
- **FR-023**: Categorical and boolean columns MUST keep the exact count per label, shuffled
  across rows.
- **FR-024**: Numeric columns MUST include the exact real min and max, and follow the chosen
  mode. Date, datetime and time columns MUST be generated as numbers and written back in the
  original string format and granularity.
- **FR-025**: ID columns MUST be generated to fit the mask, the min and max for numeric IDs,
  and the repeat structure.
- **FR-026**: The system MUST show a preview of the first 50 fake rows and a check table that
  compares target and achieved summaries for every column.
- **FR-027**: An optional step MUST be available that rescales numeric values to restore the
  exact mean and standard deviation after rounding, while keeping the bounds.

**Export**

- **FR-028**: The system MUST export a CSV that keeps the input's delimiter, quote style,
  encoding, line endings, header, byte-order mark, NA token, decimal places, leading zeros and
  date and time string formats.
- **FR-029**: The export file name MUST default to the original name with a "_fake" suffix,
  and the user MUST be able to keep the original name instead.
- **FR-030**: Users MUST be able to export the spec file separately.

**Shell, privacy and performance**

- **FR-031**: The app MUST show the WFRC logo, header and styling copied from the Scoresheet
  reference app, and a three-step stepper (Ingest, Review, Generate) that allows going back,
  with later steps recomputed.
- **FR-032**: The app MUST show a persistent notice that data is processed locally and that
  reloading clears it.
- **FR-033**: The app MUST show a live count of network requests since page load, with
  same-origin and cross-origin requests counted separately.
- **FR-034**: After the page loads, the app MUST NOT send any user data off the device and
  MUST make no cross-origin requests.
- **FR-035**: The app MUST show progress for profiling, generation and export, and stay
  responsive while they run.
- **FR-036**: The app MUST work fully in current Chrome and Edge, and in Firefox and Safari
  with single-file download.
- **FR-037**: The app MUST be keyboard operable, show a visible focus indicator and keep
  sufficient text contrast.

### Key Entities

- **Source table**: The private CSV loaded for the session. Exists only in memory, and its
  rows are never displayed or saved.
- **File settings**: Detected delimiter, encoding, quote character, header presence, line
  endings and byte-order mark, kept so the export matches the input.
- **Column profile**: One column's detected type, summary, NA tokens, sentinel codes and the
  user's overrides.
- **ID pattern**: A mask of per-position token types and length, optional min and max, and a
  repeat structure for one ID column.
- **Spec**: The small, versioned file that holds every column profile and file setting, and
  is the only artifact derived from real data.
- **Seed**: A number that, with a column name, fixes that column's random output.
- **Fake table**: The generated table, built from the spec alone.
- **Check table**: A per-column comparison of target and achieved summaries.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A roughly 500 MB CSV profiles with a visible progress indicator, and the page
  keeps responding to clicks and scrolling throughout.
- **SC-002**: For every in-scope column, the check table shows an exact match for category
  counts, NA counts, sentinel counts, min and max (100% of checked items).
- **SC-003**: Generating twice with the same spec and seed produces identical files; changing
  one column's settings changes no other column.
- **SC-004**: The same parsing code written for the real CSV reads the exported fake CSV with
  the same column names, order and types, with no changes.
- **SC-005**: After a full session (ingest, review, generate, export), the network counter
  shows zero cross-origin requests.
- **SC-006**: A saved spec contains no ID value lists and no free text, and for a table with
  50,000 IDs the spec stays under 1 MB.
- **SC-007**: An analyst can go from loading a typical table to a downloaded fake CSV in under
  10 minutes when accepting most detected defaults.
- **SC-008**: In a table with 120 columns, an analyst can find and open any single column's
  card in under 15 seconds using search or filters.
- **SC-009**: After a page reload, no real data remains available, and the app is back at the
  start step.

## Assumptions

- Users are analysts working on a desktop browser with the file on their own machine.
- A single table is processed per session. Joins and relationships across tables are not
  supported, so IDs in separately generated tables will not match.
- All columns are generated independently, so correlations and row-level rules (such as
  arrival after departure) are not preserved.
- The default categorical threshold is 50 distinct values, adjustable by the user.
- Exported files default to a "_fake" suffix, with a toggle to keep the original name.
- Excluded columns are dropped by default, with an option to keep them as all-NA.
- The WFRC branding is copied from the Scoresheet reference app, so no new visual design is
  needed.
- Values in the spec that are real (category labels, min and max, sentinel codes) are
  accepted by the privacy model in SPEC.md, and the user is told so on the Review step.
- Latest Chrome and Edge are fully supported, and other browsers use single-file download.

## Out of Scope for This Slice (Deferred, Tracked)

These items belong to later features and MUST be recorded as not-started tasks so none are
forgotten.

| Deferred item | Notes |
| --- | --- |
| Excel input and output | Includes the load dialog (sheet name dropdown, range, rows to skip, header-row toggle; never shows cell data), sheet name and header offset preservation, and the DuckDB-Excel-extension vs SheetJS test and bundling |
| Parquet input and output | Preserve dtypes, nullable integers, time zones |
| Personal identifier columns | Names, emails, phones and addresses via faker.js, en_US only for v1 |
| Free text and short string columns | Length-distribution lorem and character-class fake strings |
| Latitude, longitude and combined coordinate columns | Bounding box, precision, pair detection |
| Empty and edge-case columns beyond the basics | Fuller handling of all-NA and single-value columns |
| Folder output | Writing into a chosen folder (Chrome and Edge) |
| Offline zip release | Zip with the app and the DuckDB files, attached to each release |
| Pages deploy pipeline | Build, lint and test gates, then Pages deploy; tracked as a separate infrastructure feature |
| Multi-table hierarchy | Parent and child keys, generation order |
| Cross-column rules | A at least B, sequences, derived columns |
| Zone-based coordinates | Points inside user-supplied polygons |
| Codebook import | Value labels and sentinels from a codebook |
| SPSS and Stata input | .sav and .dta |
| Auto-generated agent README | Notes on known oddities of the fake data |
