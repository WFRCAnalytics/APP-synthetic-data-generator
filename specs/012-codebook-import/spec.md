# Feature Specification: Codebook import

**Feature Branch**: `012-codebook-import` (spec directory only; work stays on `main`)

**Created**: 2026-11-02

**Status**: Complete

**Input**: User description: "Codebook import: survey tables hold coded columns (1, 2, 3, -9) and the analyst has a codebook that says what the codes mean. Let them add it on Review so the labels show beside the codes, in the spec and in the README for agents. The fake file keeps the codes."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Say what the codes mean (Priority: P1)

On the Review overview the analyst chooses "Add a codebook": a CSV with the columns column, value and label (other common header
names work too), or JSON such as `{"mode": {"1": "Car"}}`. The app reads it in the page, keeps each label that belongs to a column
and a value the table already has, and says how many labels it added to how many columns and how many entries matched nothing.
Those labels then show beside the codes on the column's card ("1 (Car): 300"), in the saved spec, and in the README for agents
("`1` (Car)"). The fake file still holds the codes.

**Independent Test**: Add a codebook to a table with a coded column; the card, the spec and the README show the labels; the
fake file's values are unchanged.

**Acceptance Scenarios**:

1. **Given** a codebook as CSV or JSON, **When** it is added, **Then** labels for existing columns and values are kept and the
   result is reported in plain words.
2. **Given** an entry for a column or value the table does not have, **When** it is added, **Then** it is counted, not kept.
3. **Given** a codebook with no match at all, **When** it is added, **Then** nothing changes and the message says so.
4. **Given** labels on a column, **When** the person chooses "Remove the labels", **Then** they are gone from the card, the spec and
   the README.
5. **Given** a saved spec with labels, **When** it is loaded without the file, **Then** the labels are still on the cards.
6. **Given** a label longer than 100 characters, with a control character, or a file over 5 MB, **When** it is added, **Then** it is
   skipped or refused with a plain message that does not quote the file.

## Requirements *(mandatory)*

- **FR-001**: A codebook MUST be read in the page and never sent anywhere; the file is not stored.
- **FR-002**: Labels MUST be kept only for a column and a value the table already holds (a category or a sentinel code); column
  names match without regard to case, and a code written another way (1.0, 01) matches.
- **FR-003**: A label MUST be at most 100 characters and hold no control character; a column MUST hold at most 2,000 labels.
- **FR-004**: The spec MUST record labels per column as documentation (`value_labels`); it MUST refuse a label for a value the
  column does not hold. No spec version change is needed (the field is optional).
- **FR-005**: Labels MUST show on the column card, in the summary lines, and in the README for agents.
- **FR-006**: The fake file's values MUST NOT change.

## Success Criteria

- **SC-001**: For a CSV and a JSON codebook, labels reach the card, the spec and the README, and the fake file does not hold them.
- **SC-002**: A codebook with no match, a bad file or an oversized one ends in a plain message; nothing crashes.
- **SC-003**: Zero outside requests.

## Assumptions

- A label is documentation the person already has and may share with the spec; the README says its limits and labels come from the
  real table's summary.
- Out of scope: writing labels into the fake file instead of codes, SPSS or Stata label files, and editing a label by hand.
