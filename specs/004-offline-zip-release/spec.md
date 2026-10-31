# Feature Specification: Offline zip release

**Feature Branch**: `004-offline-zip-release` (spec directory only; work stays on `main`)

**Created**: 2026-10-31

**Status**: Draft

**Input**: User description: "Slice 4: Offline zip release for the WFRC Synthetic Data Generator, building on slices 1 to 3. A maintainer can publish a downloadable zip of the built site (a GitHub Release asset produced by a workflow, also buildable locally) that an analyst unzips and uses with no internet and no install of Node, from a local folder, with a documented way to open it that satisfies the app's constraints and makes no request to the internet. The zip holds the site, the Excel extension files, the word lists, a short README, a checksum file and license notices; no analytics, telemetry or real data. The page shows its version, and a tester can verify that no request leaves the machine. Releases are tagged with the spec version they write."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An analyst runs the tool from a folder with no internet (Priority: P1)

An analyst on a locked-down machine downloads the release zip, unzips it into any folder, follows a
one-page README to open the app, and does the whole job (load a CSV or Excel file, review, generate,
download the fake file and the spec) with the network switched off.

**Why this priority**: This is the reason the release exists. Many machines that hold real
respondent data cannot reach the hosted site, and the privacy promise is strongest when nothing can
leave the machine at all.

**Independent Test**: Unzip into an empty folder on a machine with the network disabled, open the app
as the README says, load a CSV and an Excel workbook, generate both fake files, and compare them with
what the hosted site produces for the same spec and seed.

**Acceptance Scenarios**:

1. **Given** the unzipped folder and no network, **When** the analyst follows the README, **Then** the
   app opens and every screen works: Ingest, Review, Generate, spec save and load.
2. **Given** the same spec and seed, **When** the offline copy and the hosted site each generate a
   file, **Then** the two files are identical in content.
3. **Given** an Excel workbook, **When** the analyst loads it offline, **Then** the sheet list, the
   profiling and the fake workbook work exactly as they do on the hosted site.
4. **Given** the analyst has not installed Node, a package manager or any developer tool, **When** they
   open the app, **Then** it works with only what is in the zip and what the operating system already
   has.

---

### User Story 2 - A tester can prove that nothing leaves the machine (Priority: P1)

A tester or a security reviewer wants evidence, not trust. They open the offline copy, see which
version it is, watch the in-app request counter during a full session, and can also check the
folder's contents against a checksum list.

**Why this priority**: The tool's value is the claim that real data never leaves the device. The
offline copy must make that claim easy to check and impossible to quietly break.

**Independent Test**: Run a full session with the browser's network tool open and the in-app counter
visible; confirm zero requests to any other machine and zero to anything outside the app's own files;
verify every file against the checksum list.

**Acceptance Scenarios**:

1. **Given** a full session (load, review, generate, download), **When** the tester reads the in-app
   counter and the browser's network log, **Then** no request goes to any address outside the
   machine, and none to any file the zip does not contain.
2. **Given** the unzipped folder, **When** the tester checks it against the checksum file, **Then**
   every file matches and no file is missing or extra.
3. **Given** the app is open, **When** the tester looks at the page, **Then** it shows the app
   version and the spec version it writes, matching the release name and the README.
4. **Given** the folder, **When** the tester searches it, **Then** it holds no analytics or telemetry
   code, no tracking identifiers and no real data.

---

### User Story 3 - A maintainer publishes a release (Priority: P2)

A maintainer tags a version and the project builds the zip automatically and attaches it to the
GitHub Release, after the same checks that gate the hosted site. The maintainer can also build the
identical zip on their own machine.

**Why this priority**: Without a repeatable build, the zip would depend on one person's machine and
could drift from the hosted site. It matters after the zip itself works.

**Independent Test**: Push a test tag; confirm a release appears with the zip and checksum attached,
and that a local build of the same commit gives a zip with the same file list and checksums.

**Acceptance Scenarios**:

1. **Given** a version tag, **When** the release workflow runs, **Then** it runs the checks first and
   publishes the zip and its checksum file to the release only if they pass.
2. **Given** a commit, **When** a maintainer builds the zip locally, **Then** its file list and
   file checksums equal the ones the workflow produced for that commit.
3. **Given** a release, **When** a user reads its name, **Then** it states the app version and the spec
   file version it writes, so a saved spec can be matched to the right release.
4. **Given** the zip is built, **When** a check runs on it, **Then** it fails the release if any file
   needed offline is missing, any file that does not belong is present, or any address outside the
   app's own files is referenced.

---

### User Story 4 - An analyst opens the zip in the browser they already have (Priority: P2)

Browsers restrict what a page opened straight from disk may do. The analyst should not have to
understand that: the README names the supported browsers and the exact steps, and if a small helper
is needed to open the app, it says so plainly and the helper ships in the zip.

**Why this priority**: A release that only works in one configuration, or fails silently in others,
would send analysts back to the hosted site or to unsafe workarounds.

**Independent Test**: On a clean Windows machine and in each supported browser, follow only the
README and reach a working app; deliberately open the app the wrong way and confirm the page or the
README tells the analyst what to do.

**Acceptance Scenarios**:

1. **Given** a supported browser, **When** the analyst follows the README opening steps, **Then** the
   app works with no browser setting changed and no security prompt other than the operating
   system's normal one for a first-run helper.
2. **Given** the app is opened in a way that cannot work (for example straight from the folder when
   that is not supported), **When** the page loads, **Then** it shows a short message that says what
   went wrong and what to do, and does not appear to work and then fail.
3. **Given** a helper is part of the opening steps, **When** the analyst reads the README, **Then** the
   README states that the helper exists, what it does (serves the files on this machine only), that
   it makes no outside connection, and how to stop it.
4. **Given** the helper is running, **When** another computer on the network tries to reach it,
   **Then** it is refused, because the helper listens only on the machine it runs on.

---

### Edge Cases

- The zip is unzipped into a folder whose path has spaces, non-ASCII characters or is very long, or
  onto a network drive: the opening steps must still work or say clearly that they cannot.
- Two copies of different versions are unzipped side by side, or one is run while another is open:
  the helper must not serve the wrong folder, and the page's version display makes the difference
  visible.
- The browser has cached files from an earlier version of the offline copy: the page must not mix
  versions.
- The analyst's antivirus or policy blocks the helper: the README names the alternative and what to
  tell their IT team, without asking them to lower any protection.
- The helper's usual port is already in use: it picks another or says so, and never exposes the
  files to the network.
- A file in the folder is altered or missing: the checksum list lets the analyst or tester detect it;
  the app shows a clear message if a file it needs is missing.
- The Excel part cannot start because its files are missing: CSV still works and the message says
  that Excel needs the missing files.
- Long-term storage or a second browser profile: nothing from a session is kept in the folder or in
  the browser after the page is closed, except what slices 1 to 3 already allow.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The release MUST be a single zip that an analyst can unzip into any folder and use with no
  internet connection and no developer tools installed.
- **FR-002**: Every feature of the hosted site (CSV and Excel input and output, Review, Generate,
  spec save and load) MUST work in the offline copy, and the same spec and seed MUST give files
  identical in content to the hosted site's.
- **FR-003**: The zip MUST contain the built site, every file the Excel reader needs, the word lists,
  a README, a checksum file and the license notices for the app and its bundled components, and no
  other file.
- **FR-004**: The zip MUST NOT contain analytics or telemetry code, tracking identifiers, real data,
  test fixtures, source maps of private paths, or access tokens.
- **FR-005**: The offline copy MUST make no request to any address outside the machine, and no
  request to any file the zip does not contain, during a full session; the in-app request counter
  MUST show this the same way it does on the hosted site.
- **FR-006**: The README MUST fit on one page and state: how to open the app step by step, the
  supported browsers, the version, how to verify the checksums, how to stop the helper if there is
  one, and how to confirm that nothing leaves the machine.
- **FR-007**: If opening the app needs a helper, the helper MUST ship in the zip, MUST need nothing
  installed beyond what the operating system already provides, MUST serve only the zip's own files,
  MUST listen only on the machine it runs on, MUST make no outside connection, and MUST be described
  plainly in the README as an extra step.
- **FR-008**: If the app is opened in a way that cannot work, the page MUST show a short message that
  says what is wrong and what to do, instead of failing silently.
- **FR-009**: The page MUST show the app version and the spec file version it writes, in the page and in
  the help guide, and these MUST match the release name and the README.
- **FR-010**: The release MUST be named and tagged with the app version and the spec file version it
  writes, so a saved spec can be matched to a release.
- **FR-011**: A workflow MUST build the zip and its checksum file for a version tag and attach both to the
  release, only after the same lint, type, test and browser checks that gate the hosted site pass.
- **FR-012**: A maintainer MUST be able to build the same zip locally with one documented command, and
  the file list and checksums MUST equal the workflow's for the same commit.
- **FR-013**: A check on the built zip MUST fail the release when a needed file is missing, a file that
  does not belong is present, or the app's files reference an address outside the app's own files.
- **FR-014**: An automated test MUST open the unzipped copy the way the README says, with outside
  network access blocked, and run a full CSV and a full Excel session, including generating, in at
  least one browser; the test MUST fail if any request leaves the machine.
- **FR-015**: Files from one version MUST NOT be mixed with files from another by the browser's cache, and
  the page MUST make clear which version is running.
- **FR-016**: Everything the hosted site does for privacy (no cookies, no stored data, no real rows
  displayed) MUST hold unchanged in the offline copy.

### Key Entities

- **Release zip**: The one file an analyst downloads. Holds the app, the Excel reader files, word
  lists, README, checksums and licenses. Identified by app version and spec version.
- **Checksum list**: A list of every file in the zip with its checksum, so the folder can be verified
  and two builds of the same commit compared.
- **Opening helper**: A small program that ships in the zip, serves the folder's files to the browser
  on this machine only, and stops when the analyst says so. Present only if opening straight from
  disk cannot work.
- **Version stamp**: The app version and the spec file version it writes, shown in the page, the help
  guide, the README and the release name.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An analyst who has never seen the tool goes from the downloaded zip to a working app in
  under 5 minutes using only the README.
- **SC-002**: A full session in the offline copy (CSV and Excel, from load to downloaded fake file and
  spec) produces zero requests to any address outside the machine and zero to files the zip does not
  contain, in 100% of automated runs and in the tester's manual check.
- **SC-003**: The same spec and seed give a file identical in content on the offline copy and on the
  hosted site for every supported format.
- **SC-004**: 100% of the zip's files verify against the checksum list, and a local build and the
  workflow build of the same commit have the same file list and checksums.
- **SC-005**: A release is published without manual file handling: a version tag results in the zip and
  checksum attached to the release, and a failed check prevents publication.
- **SC-006**: Every way of opening the app that cannot work ends in a message the analyst can act on;
  none ends in a blank page or a half-working app.
- **SC-007**: The zip is no larger than the hosted site's total files plus the README, checksums and
  licenses, and unzips and opens in under 30 seconds on a typical office laptop.
- **SC-008**: Following the README on a clean Windows machine in each supported browser reaches a working
  app, confirmed by a person other than the author before the first release.

## Assumptions

- The main audience uses Windows with a current Chrome or Edge; Firefox and Safari are supported where
  the hosted site already is, and the README says which opening steps apply to which.
- Browsers may refuse some features (background workers, WebAssembly loading) for pages opened
  straight from disk. The plan will test this in each supported browser; if it does not work
  everywhere, a small helper that ships in the zip is the documented way to open the app, and the
  README says so openly. No browser setting is ever to be lowered.
- The hosted site is not changed for analysts: the site address stays the same, and the offline copy
  is an addition, not a replacement.
- The spec file version the app writes today is 3; the release name carries whatever version is
  current at release time.
- Releases are made from tags on `main` by the maintainers; there is no auto-update, so an analyst
  who wants a newer version downloads a new zip, and the version stamp shows which one they have.
- The repository's existing privacy tests, request counter and strict content policy apply to the
  offline copy unchanged; this slice adds proof for the offline packaging, not new privacy rules.
- The license notices cover the app (MIT) and bundled components (the engine, the Excel reader, word
  lists, fonts and icons) as their licenses require.
- Out of scope: installers, auto-update, desktop wrappers, code signing, Parquet, other locales,
  folder output and multi-table.
