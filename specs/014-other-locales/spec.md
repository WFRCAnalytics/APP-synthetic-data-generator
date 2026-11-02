# Feature Specification: Other languages and regions for invented personal values

**Feature Branch**: `014-other-locales` (spec directory only; work stays on `main`)

**Created**: 2026-11-02

**Status**: Complete

**Input**: User description: "Other locales: invented names, emails, phone numbers and street addresses were US English only. Let a personal column come from another language and region (Spanish for Spain and Mexico, French, German, Portuguese for Brazil), in a table from a file, a saved spec or a design."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Names and addresses that look like the real region's (Priority: P1)

An analyst whose survey covers Spanish-speaking households has a `nombre` column and a `direccion` column. On Review, each personal
column has a "Language and region" setting (United States by default). They pick Spanish, Mexico: the sample values, the fake
file and the README use Mexican names, street names and phone shapes. Values are invented from the region's word lists, never copied;
emails use plain letters and digits (accents taken off); phone numbers follow the real column's shape, or the region's usual one.

**Independent Test**: A personal column set to Spanish, Spain gives names with Spanish letters, emails of plain letters, phone numbers
of the region's shape and addresses with a house number; the same spec and seed give the same file; US English is unchanged.

**Acceptance Scenarios**:

1. **Given** a name, email, phone or address column, **When** the person chooses a region, **Then** the sample, the fake file, the saved
   spec (`locale`) and the README name that region; choosing United States removes the field.
2. **Given** a web address, IP address or SSN-style column, **When** it is shown, **Then** it offers no region and a spec that gives one
   is refused.
3. **Given** a region, **When** values are invented, **Then** no two different values are the same within the space, as for US English.
4. **Given** a table designed from scratch, **When** a personal column is added, **Then** it can be given a region too.
5. **Given** a US English column, **When** the spec is built, **Then** it is byte-for-byte what it was (no `locale`).

## Requirements *(mandatory)*

- **FR-001**: The regions offered MUST be United States (default), Spain, Mexico, France, Germany and Brazil.
- **FR-002**: Invented first names, last names, full names, emails, phone numbers and street addresses MUST be made from the region's word
  lists; no value is taken from real data.
- **FR-003**: Emails MUST use only ASCII letters and digits; phone numbers MUST follow the profiled shape of the real column when there is one.
- **FR-004**: The spec MUST record the region as an optional `locale` on a personal column and refuse an unknown region, or a region on
  a kind a region does not change; no spec version change is needed.
- **FR-005**: The generator MUST be deterministic for a spec and seed, and the word lists MUST load only in the generating worker.
- **FR-006**: The README for agents MUST name the region of an invented column.

## Success Criteria

- **SC-001**: For each region and kind, a sample of 3,000 values has no repeat inside the space.
- **SC-002**: US English output is unchanged (the golden bytes still match).
- **SC-003**: The generating worker grows by no more than 120 KB gzipped, and the page and the profiling worker do not grow by a word list.
- **SC-004**: Zero outside requests.

## Assumptions

- Word lists come from the same library as US English; accents and letters of the region are kept in names and streets.
- Out of scope: more regions, region-specific ID or tax numbers, and translating the app.
