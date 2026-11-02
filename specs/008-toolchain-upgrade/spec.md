# Feature Specification: Toolchain upgrade

**Feature Branch**: `008-toolchain-upgrade` (spec directory only; work stays on `main`)

**Created**: 2026-11-02

**Status**: Draft

**Input**: User description: "Slice 8: upgrade the toolchain. The app's build, test, lint and type tools and its UI library are several major versions behind. Bring them to current versions without changing what the app does, what it writes, or any privacy guarantee. DuckDB-WASM stays pinned; its extension files must still match. Keep the app working on every browser and in the offline zip."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Same app, current tools (Priority: P1)

A maintainer upgrades the build tool, the test runner, the test DOM, the linter, the type checker and the UI library to
their current major versions. Nothing the analyst sees or gets changes: the same screens, the same fake files for the
same spec and seed, the same spec files, the same offline zip. Every existing test passes, in every tested browser.

**Why this priority**: Old majors stop getting security and compatibility fixes, and new browser and Node versions break
them first. Doing it now, between feature slices, keeps the risk small and the cause clear.

**Independent Test**: Run lint, type check, unit, component and integration tests, the end-to-end suite in Chromium, Edge,
Firefox and WebKit, and the offline zip session, then generate a file from a fixed spec and seed and compare its bytes with
the bytes made before the upgrade.

**Acceptance Scenarios**:

1. **Given** the upgraded tools, **When** the whole test suite is run, **Then** every test that passed before passes now,
   with no test removed or loosened to make that happen.
2. **Given** a fixed spec and seed for each format (CSV, Excel, Parquet, JSON), **When** a file is generated, **Then** its
   bytes equal those made before the upgrade.
3. **Given** the upgraded build, **When** the offline zip is built and verified, **Then** it passes the same checks as before
   (no source maps, no fixtures, a checksum list, the extension files) and a full session runs with every outside request
   refused.
4. **Given** the upgraded build, **When** the page is loaded under the strict content policy, **Then** there is no policy
   violation, no request outside the site, and the network counter reads zero outside.
5. **Given** the upgraded UI library, **When** every screen is used with the keyboard, in both themes, **Then** there is no
   accessibility violation that was not there before.

---

### User Story 2 - Upgrades land in small, checkable steps (Priority: P2)

The upgrade is done in groups, each verified and committed on its own: build and test tools first, then lint, then the type
checker, then the UI library. If one group breaks something, it can be undone without losing the others.

**Why this priority**: A single large upgrade hides which change broke what.

**Independent Test**: Each group has its own commit and a passing suite at that commit.

**Acceptance Scenarios**:

1. **Given** the history of this slice, **When** each commit is checked out, **Then** the suite passes at that commit.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The build tool, test runner, test DOM, linter and its plugins, type checker, and UI library MUST each be moved to
  the latest major version that works with the others, or the slice records why one stays.
- **FR-002**: The DuckDB-WASM version MUST stay pinned, and the extension files fetched for it MUST still match its engine
  version.
- **FR-003**: For a fixed spec and seed, every output format MUST produce the same bytes as before the upgrade.
- **FR-004**: The saved spec format and version MUST NOT change.
- **FR-005**: The content policy, the request counter, the rule that no data leaves the device, and every privacy test MUST be
  unchanged and passing.
- **FR-006**: The production bundle MUST NOT hold anything it did not hold before: no source maps, no test code, no fixtures,
  and the word lists still only in the generating worker.
- **FR-007**: The offline zip MUST still be built and verified by the same scripts and run an offline session on Linux, macOS
  and Windows.
- **FR-008**: No test MAY be deleted or weakened to pass; a test that must change because a tool changed its behaviour is
  changed to check the same thing.
- **FR-009**: Continuous integration MUST run on the Node version the tools support, and the project's stated minimum Node
  version MUST say so.

### Key Entities

- **Tool group**: A set of tools upgraded and verified together (build and test, lint, types, UI library).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the tests that passed before pass after, in each tested browser.
- **SC-002**: For each of the four formats, the bytes made from a fixed spec and seed are identical before and after.
- **SC-003**: Zero outside requests and zero content-policy violations in a full session, hosted and offline.
- **SC-004**: The production bundle is no more than 10% larger than before, and the build takes no longer.
- **SC-005**: Every tool group is its own commit with a passing suite.

## Assumptions

- A tool whose newest major version does not yet work with the rest (a plugin that has not caught up) stays on its last
  working version, and the slice records it.
- The UI library's newest major may need small code changes (types, ref handling); behaviour stays the same.
- The app is in beta, so no migration of saved files is needed.
- Out of scope: new features, a new test framework, a change of bundler beyond what the build tool's own upgrade brings, and a
  DuckDB-WASM upgrade.
