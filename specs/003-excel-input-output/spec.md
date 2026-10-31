# Feature Specification: Excel Input and Output

**Feature Branch**: `003-excel-input-output`

**Created**: 2026-10-31

**Status**: Draft

**Input**: User description: "Slice 3: Excel input and output. Read an .xlsx workbook through a load dialog that shows worksheet names only, profile the chosen sheet like a CSV, and write a fake .xlsx that reads back with the same sheet name, header offset, column types and number formats (SPEC.md, constitution Principles I, III, IV)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Turn an Excel sheet into a fake Excel sheet (Priority: P1)

An analyst keeps a private survey table in an Excel workbook. They choose the .xlsx file, and a
load dialog lists the sheet names in a dropdown and nothing from inside the sheets. They pick the
sheet, confirm where the table starts (rows to skip, header row, optional cell range), and the app
profiles it exactly as it does a CSV. They review the columns, generate, and download a fake .xlsx
whose sheet has the same name, the same header position, the same column names and order, and the
same kinds of cells (text, numbers, dates) with the same number formats. Code that reads the real
workbook with some arguments reads the fake one with the same arguments.

**Why this priority**: Most survey tables arrive as Excel files. Without this, an analyst has to
export to CSV first, which can silently change dates, leading zeros and formats.

**Independent Test**: Load a workbook with several sheets, pick one, accept the defaults, generate,
and download. Read the real and the fake workbook with the same code and the same arguments and
compare sheet name, column names, column types and number formats.

**Acceptance Scenarios**:

1. **Given** a workbook with three sheets, **When** the user chooses it, **Then** a dialog lists the
   three sheet names in a dropdown, shows no cell value, and offers rows to skip, a header-row
   toggle and an optional cell range.
2. **Given** a chosen sheet, **When** the user confirms, **Then** the app shows row count, column
   count and column names (never rows) and profiles the sheet like a CSV, with one card per column.
3. **Given** a reviewed sheet and a seed, **When** the user generates, **Then** a preview of the
   first 50 fake rows and the check table are shown, and the user can download a fake workbook.
4. **Given** the downloaded fake workbook, **When** the same reading code and arguments used for the
   real workbook are run on it, **Then** the sheet name, header offset, column names, order and
   column types match.
5. **Given** a workbook with sheets that are hidden, **When** the dialog opens, **Then** hidden
   sheets are listed and marked as hidden, and the visible first sheet is preselected.

---

### User Story 2 - Keep the Excel quirks that analysis code depends on (Priority: P1)

Excel stores things in ways a CSV does not: dates as serial numbers with a date format, numbers
that are really text, codes with leading zeros, cells that are blank versus empty text, formulas,
and merged cells. The analyst needs the fake workbook to carry these quirks over, so code written
on it behaves the same on the real one.

**Why this priority**: The quirks are exactly where analysis code breaks when moving between a
sample and the real file. They are the reason to support Excel itself rather than a CSV export.

**Independent Test**: Load a workbook that has each quirk in one column, generate, and read both
workbooks with the same code: each column has the same type and format in both.

**Acceptance Scenarios**:

1. **Given** a date column stored as numbers with a date format, **When** the fake workbook is read,
   **Then** that column holds dates with the same display format and the same range.
2. **Given** a column of numbers stored as text (for example "00123"), **When** the fake workbook is
   read, **Then** that column holds text with the same leading zeros, not numbers.
3. **Given** numbers shown with two decimals and a thousands separator, **When** the fake workbook
   is read, **Then** the cells carry the same number format.
4. **Given** a cell range of the sheet that has formulas, **When** the sheet is profiled, **Then**
   each formula is read as its last calculated value, and no formula text reaches the spec or the
   fake file.
5. **Given** blank cells and cells holding empty text in the same column, **When** the fake workbook
   is written, **Then** blank stays blank and empty text stays empty text, in the same numbers.
6. **Given** merged cells in the header area or the table, **When** the sheet is read, **Then** the
   merged value is read once, in its top-left cell, and the app tells the user merged cells were
   found.

---

### User Story 3 - Know the load settings and the limits before waiting (Priority: P2)

An analyst with a large workbook wants to know how much memory the load needs, and to see the
Excel settings saved in the spec so that the same workbook can be read again the same way.

**Why this priority**: An Excel file expands many times in memory when read, so a file that looks
small can be too large for a tab. A warning prevents a failed long wait.

**Independent Test**: Choose a large workbook and see the size warning before profiling. Save the
spec and open it: it names the sheet, the range, the rows skipped and the header setting.

**Acceptance Scenarios**:

1. **Given** a workbook above the size where memory becomes a risk, **When** the user chooses it,
   **Then** a warning says how much memory about this much Excel data needs, before profiling.
2. **Given** a profiled sheet, **When** the spec is saved, **Then** it records the Excel source
   (sheet name, cell range, rows skipped, header) and the number formats, and no cell value.
3. **Given** a saved Excel spec, **When** it is loaded without a workbook, **Then** the user can
   still generate a fake workbook from it.

---

### User Story 4 - Prove that nothing real is kept and nothing leaves the device (Priority: P1)

The analyst and the data owner need the same guarantees for Excel as for CSV: no real cell value
anywhere the app shows or saves, no network after the page loads, and the reading components are
part of the site itself.

**Why this priority**: Excel files often hold more than the table (other sheets, comments, hidden
data). The guarantees must hold for them too.

**Independent Test**: Run the existing leak checks against a workbook with real-looking values in
the chosen sheet and in other sheets: none appears in the page, the spec, the preview, the
download or an error message, and the network counter stays at zero outside requests.

**Acceptance Scenarios**:

1. **Given** a workbook with personal values in several sheets, **When** a full session is run,
   **Then** no cell value from any sheet appears anywhere the app shows or saves.
2. **Given** the page loaded and an Excel file chosen, **When** the workbook is read, **Then** no
   request leaves the site's own address, and the network counter shows zero outside requests.
3. **Given** a workbook that cannot be read (damaged, password protected, an old .xls), **When** it
   is chosen, **Then** a clear message says what is wrong without quoting any cell content.

---

### Edge Cases

- A workbook with one sheet: the dropdown shows it and it is preselected.
- A sheet with empty rows above the header: the app suggests the number of rows to skip, and the
  user can change it. The fake workbook keeps the same empty rows above the header.
- A sheet with a title or note above the table, or totals below it: the user can set the cell
  range to the table only.
- A very wide sheet (hundreds of columns): works as in a CSV, with the virtualized column list.
- Column letters beyond Z (AA, AB, ...): ranges and the written file use them correctly.
- A header row with blank or duplicate names: reported as for a CSV header.
- A column with numbers and dates mixed: flagged under "needs attention" as for a CSV.
- Dates before 1900 or in the 1904 date system: read in the system the workbook declares and
  written the same way.
- Percentages, currency and scientific formats: kept as number formats on the cells.
- A workbook with a password or damaged: refused with a clear message.
- An .xls file or a macro-enabled .xlsm file: refused or read without macros, with a message.
- A sheet name with spaces or accents: kept exactly in the fake workbook.
- A file chosen with the wrong extension: the app checks the content, not the name.
- A workbook above the memory limit: the load stops with a message before the tab fails.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to choose an .xlsx workbook, and the app MUST list its sheet names
  in a dropdown, marking hidden sheets, without showing any cell value.
- **FR-002**: The dialog MUST offer rows to skip, a header-row toggle and an optional cell range,
  and MUST suggest rows to skip when empty rows precede the table.
- **FR-003**: Only the chosen sheet MUST be read. Other sheets MUST NOT be profiled, shown or kept.
- **FR-004**: The chosen sheet MUST be profiled like a CSV: the same column types (categorical,
  numeric, date and time, survey ID, personal identifier, free text, short string), the same
  review, overrides, protections and check table.
- **FR-005**: Dates stored as serial numbers with a date format MUST be read as dates, with their
  display format kept, in the date system the workbook declares.
- **FR-006**: Numbers stored as text and codes with leading zeros MUST be kept as text, and numbers
  MUST keep their displayed decimals, thousands separators, percent, currency and scientific
  formats as cell formats.
- **FR-007**: Formulas MUST be read as their last calculated values. No formula text MUST reach the
  spec or the fake file.
- **FR-008**: Blank cells and cells holding empty text MUST be told apart, counted separately, and
  written back in the same numbers.
- **FR-009**: Merged cells MUST be read once, in the top-left cell, and the user MUST be told when
  merged cells were found.
- **FR-010**: The spec MUST record the Excel source: sheet name, cell range, rows skipped, header
  setting and date system, and the number formats per column, and MUST hold no cell value, text or
  formula.
- **FR-011**: The export MUST be an .xlsx whose sheet has the same name, the same rows above the
  header, the same header row, column names and order, the same cell types and the same number
  formats as the real sheet.
- **FR-012**: The fake workbook MUST hold only the chosen sheet. The user MUST be told that other
  sheets are not included.
- **FR-013**: The export file name MUST default to the original name with a "_fake" suffix, with
  the option to keep the original name.
- **FR-014**: Every generated value MUST be identical for the same spec and seed, and changing one
  column MUST NOT change another, as for CSV.
- **FR-015**: A workbook above a size where memory becomes a risk MUST show a warning before
  profiling, saying roughly how much memory it needs, and a workbook that cannot fit MUST stop with
  a clear message.
- **FR-016**: Reading and writing a workbook MUST work with no network request after the page has
  loaded, and every component it needs MUST be served from the site itself.
- **FR-017**: The check that the reading component can open a small workbook MUST run in the
  automatic checks before every deploy, and the decision about which reading approach is used MUST
  be recorded with its evidence.
- **FR-018**: A damaged, password-protected or unsupported file (an old .xls, a macro workbook)
  MUST be refused or read safely with a clear message that quotes no cell content.
- **FR-019**: No real cell value from any sheet MUST appear in the page, the spec, the preview, the
  downloaded file, an error message or the browser's storage.
- **FR-020**: Loading an Excel spec without a workbook MUST work for generating, as for CSV specs,
  and a spec made for CSV MUST still produce a CSV.

### Key Entities

- **Workbook**: The chosen .xlsx file. Only sheet names, visibility and the date system are read
  from it before the user confirms.
- **Sheet source settings**: The sheet name, cell range, rows to skip, header setting and date
  system that make the same sheet readable again.
- **Cell format**: How a column's cells are displayed: general, number with decimals, thousands,
  percent, currency, scientific, date, time, or text.
- **Fake workbook**: The generated .xlsx with one sheet whose layout and formats mirror the real
  sheet and whose values are invented or reshuffled under the same rules as a CSV.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a typical workbook, the same reading code with the same arguments reads the real
  and the fake workbook with identical sheet name, header offset, column names, column order and
  column types.
- **SC-002**: Dates, numbers stored as text, leading zeros and number formats read back identically
  in the fake workbook for every column of the test workbook.
- **SC-003**: No real cell value from any sheet appears in the page, the spec, the preview, the
  downloaded file, any error message or browser storage in any test.
- **SC-004**: The network counter shows zero outside requests after a full Excel session, and no
  request is made to any address other than the site's own.
- **SC-005**: Generating twice with the same spec and seed gives workbooks with identical cell
  values, and changing one column changes no other.
- **SC-006**: A 50 MB workbook profiles in under 5 minutes and generates and exports in under 5
  minutes on a reference office laptop, and a workbook too large to fit is stopped with a message
  before the tab fails.
- **SC-007**: A saved Excel spec stays under 1 megabyte and holds the sheet name, range, rows
  skipped, header setting and formats and no cell value.
- **SC-008**: An analyst can choose a workbook, pick a sheet and reach the review screen in under
  a minute for a typical file (a person-timing check signed off by the maintainer).

## Assumptions

- Only the .xlsx format is read and written. Old .xls files and macro-enabled workbooks are out of
  scope and are refused or read without macros.
- The fake workbook holds one sheet, the chosen one.
- Formatting beyond number and date formats (fonts, colors, column widths, conditional formats,
  charts, comments, data validation) is not kept.
- The reading approach is the same engine already used for CSV, with its Excel reader served from
  the site; a separate library is used only if that reader proves insufficient, and the outcome is
  recorded.
- The writing approach is decided in planning; the user-visible requirement is the layout and
  format fidelity in FR-011.
- Memory limits mean workbooks larger than a few hundred megabytes of expanded data cannot be read
  in a browser tab; the size warning and the stop message are the safeguard.
- Everything about invented values, free text and short strings follows slice 2, and everything
  about the review screen, protections and checks follows slice 1.
- Offline zip, folder output, Parquet, other languages and coordinates remain out of scope.
