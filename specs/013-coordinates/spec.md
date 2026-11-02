# Feature Specification: Coordinates (latitude, longitude, map positions)

**Feature Branch**: `013-coordinates` (spec directory only; work stays on `main`)

**Created**: 2026-11-02

**Status**: Complete

**Input**: User description: "Coordinates: columns of latitude and longitude, and projected map positions (zone coordinates such as eastings and northings), were left out as unsupported. Support them the way the constitution allows: keep only a bounding box and the decimal places, never the shape of where people are, and spread values evenly inside the box."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Latitude and longitude columns come through (Priority: P1)

A table has `home_lat` and `home_lon`. They are read as decimal columns and marked as coordinates: Review's card says "Only the
bounding box is kept", and the column's Coordinate setting shows Latitude or Longitude. The saved spec holds the column's lowest
and highest value and its decimal places, with no mean, spread or percentiles. The fake file has values inside the box, spread
evenly, with the same decimal places.

**Independent Test**: A CSV with `lat` and `lon` in a bounding box; the spec has `coordinate: "lat"`, `mode: "uniform"`, min, max
and decimals and none of mean, sd or quantiles; the fake values lie inside the box.

**Acceptance Scenarios**:

1. **Given** a decimal column named and ranged like a latitude or longitude, **When** it is profiled, **Then** it is marked as a
   coordinate of that axis; a name that fits but a range that cannot be the axis is not marked.
2. **Given** a projected position (easting, northing, x_coord, y_coord) with a range of at least 1,000, **When** it is profiled,
   **Then** it is marked as an X or Y coordinate; a small x or y is not.
3. **Given** a coordinate, **When** the spec is built, **Then** it holds `coordinate`, `mode: "uniform"`, `min`, `max` and `decimals`
   only (no mean, spread, percentiles or rescale).
4. **Given** a coordinate, **When** values are generated, **Then** they lie inside the box with the recorded decimals.
5. **Given** the Coordinate setting on any decimal or whole-number column, **When** the person chooses No, an axis, or another
   axis, **Then** the column is an ordinary number again, or a coordinate of that axis, with the right numeric controls shown.

### User Story 2 - The spec cannot be used to recover where people are (Priority: P1)

A spec that says a column is a coordinate must not hold anything more than the bounding box and decimals, and must be refused if it
does. Combined coordinates (`(lat, lon)`) and WKT shapes stay unsupported and left out.

**Acceptance Scenarios**:

1. **Given** a spec whose coordinate has a mean, spread or percentiles, a mode other than uniform, more than 8 decimals, or a box
   outside the axis (a latitude beyond 90), **When** it is loaded, **Then** it is refused with a plain message.
2. **Given** a column of another type with `coordinate`, **When** it is loaded, **Then** it is refused.

## Requirements *(mandatory)*

- **FR-001**: Decimal columns named like a latitude, a longitude, an easting or a northing, with a range that fits the axis, MUST be
  marked as coordinates by the profiler; the person MAY change that on Review.
- **FR-002**: A coordinate MUST be written to the spec as its axis, uniform mode, lowest and highest value and decimal places only.
- **FR-003**: The validator MUST refuse a coordinate that holds a mean, spread or percentiles, any other mode, a box outside the axis,
  more than 8 decimals, or a column that is not a number.
- **FR-004**: Generated coordinates MUST lie inside the box and be spread evenly; nothing about the real distribution is kept.
- **FR-005**: Combined and WKT coordinates MUST stay unsupported.
- **FR-006**: The README for agents MUST describe a coordinate as a bounding box.
- **FR-007**: No spec version change is needed (the field is optional).

## Success Criteria

- **SC-001**: In the zoo fixture, `lat` and `lon` are decimals marked as coordinates, and `coord_pair` and `wkt_point` stay unsupported.
- **SC-002**: A saved spec of a coordinate column holds no quantiles, mean or spread in any browser.
- **SC-003**: Zero outside requests.

## Assumptions

- The exact lowest and highest values of a coordinate are the bounding box the constitution allows; their precision is the decimals.
- Out of scope: projections, converting between systems, clustering, shapes, and designing a coordinate column from scratch.
