# Feature Specification: README for agents

**Feature Branch**: `011-agent-readme` (spec directory only; work stays on `main`)

**Created**: 2026-11-02

**Status**: Complete

**Input**: User description: "An agent README. The tool exists so AI coding agents work on fake data, so the fake file should come with a short page that tells an agent what it is: that it is not real, how it is laid out, what each column holds, and how to use it."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A page that tells an agent what the file is (Priority: P1)

After generating, the analyst downloads a README for agents next to the fake file and the spec. It is a plain Markdown page named
after the fake file (`trips_fake_README.md`). An agent that is handed the folder reads it first and knows: the data is invented,
what the file's type and layout are, how many rows and columns there are, what each column holds (kind, limits or labels,
format, how much is missing), and how to use it (write code against it, never hunt for real people, do not fit models for
findings on it).

**Independent Test**: Generate from a file, download the README, and read it: it names the file, gives the row and column counts,
lists every written column with its kind and what it holds, leaves out dropped and unsupported columns, and holds no row of the
real file.

**Acceptance Scenarios**:

1. **Given** a generated file, **When** the person chooses "Download README for agents", **Then** a Markdown file named after the
   fake file with `_README.md` is downloaded.
2. **Given** any file type, **When** the README is read, **Then** it says the type and its layout (delimiter and header for CSV,
   the sheet for a workbook, the schema note for Parquet, the form and indent for JSON).
3. **Given** columns left out of the fake file, **When** the README is read, **Then** they are not listed, and a line says how many
   are missing.
4. **Given** a column with many labels, **When** the README is read, **Then** at most twelve are shown, then "...".
5. **Given** the same spec and seed, **When** the README is made twice, **Then** the text is the same.

## Requirements *(mandatory)*

- **FR-001**: The README MUST be built from the spec alone and hold only what the spec holds: names, kinds, limits, counts,
  category labels, formats and layout. It MUST NOT hold a row, an ID, a name or any free text of the real table.
- **FR-002**: It MUST say plainly that the data is not real and what it is not good for, and that labels and limits come from the
  real table's summary.
- **FR-003**: It MUST work for every file type the app writes, including designed tables.
- **FR-004**: A table cell MUST stay on one line whatever a label holds.
- **FR-005**: Nothing is sent anywhere; the README is made in the page and downloaded like the spec.

## Success Criteria

- **SC-001**: For each file type, the README lists every written column and none of the left-out ones.
- **SC-002**: No marker planted in a real file's values appears in the README.
- **SC-003**: Zero outside requests.

## Assumptions

- The README is English and Markdown; it is a separate download, not a change to the fake file.
- Out of scope: translations, a README for the spec file itself, and embedding the README in a zip.
