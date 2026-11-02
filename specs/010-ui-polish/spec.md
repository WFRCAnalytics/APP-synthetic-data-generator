# Feature Specification: UI polish (Generate and Design)

**Feature Branch**: `010-ui-polish` (spec directory only; work stays on `main`)

**Created**: 2026-11-02

**Status**: Complete

**Input**: User description: "Polish the interface: the Generate check table shows raw JSON in its cells and hides its result column off to the side, and the Design screen's list is a plain list of names while Review is a data dictionary. Make them read the same way as Review: clear, tinted by type, with less to decode."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A check table that reads at a glance (Priority: P1)

After generating, the analyst reads the check table to see whether every summary was met. Counts per label and repeat structures
read as "bus: 80, car: 200" instead of raw JSON; the result of each check is the last column with a tick or a cross, and always
inside the table without sideways scrolling; failures stay first.

**Independent Test**: Generate from a spec with categorical and ID columns; the table shows no braces or quotes, all five columns
fit at 1440 pixels, and a result icon sits beside each Pass or Differs.

**Acceptance Scenarios**:

1. **Given** a check whose value is a small JSON object of counts, **When** the table is shown, **Then** the cell reads as
   `label: count` pairs, at most four, with "and N more" after them, and its title holds the full original text.
2. **Given** any check, **When** the table is shown, **Then** its Result cell shows an icon and the word Pass or Differs.
3. **Given** a value that is not an object of counts, **When** the table is shown, **Then** it is shown as it is.

### User Story 2 - The Design list reads like Review (Priority: P1)

The list of designed columns is a table with a tinted row per kind, the kind's name, how much is left blank, and a short line
saying what the column holds ("18 to 90, around 40", "3 labels", "P9999"), the same way Review's list does.

**Independent Test**: Add one column of each kind; each row shows its kind, its blank share and what it holds, tinted in the
kind's colour; the list works with the keyboard as before.

**Acceptance Scenarios**:

1. **Given** a designed column, **When** the list is shown, **Then** its row has the kind's icon and colour, its name, its kind,
   its blank share and a line describing what it holds, built only from what the person typed.
2. **Given** the list on a narrow window, **When** it is shown, **Then** only the name and the kind remain.
3. **Given** the list, **When** the arrow keys, search and kind chips are used, **Then** they work as before.

## Requirements *(mandatory)*

- **FR-001**: The check table MUST format counts-per-label values as readable pairs and keep the full text in the cell's title.
- **FR-002**: The check table MUST show its Result with an icon and fit its five columns without horizontal scrolling at 1440 px.
- **FR-003**: The Design list MUST show kind, blank share and a description of what each column holds, tinted by kind.
- **FR-004**: No change to what is generated, written, saved or sent; no new request or storage.
- **FR-005**: The accessibility checks pass in both themes, and the existing tests pass without being weakened.

## Success Criteria

- **SC-001**: No raw JSON braces appear in the check table for the survey fixtures.
- **SC-002**: The accessibility suite passes in light and dark themes; unit tests and the browser tests for Generate and Design pass.
- **SC-003**: Zero outside requests, as before.

## Assumptions

- A tooltip or a title holds anything that would otherwise crowd a cell.
- Out of scope: new features, changes to Review, and any change to the checks themselves.
