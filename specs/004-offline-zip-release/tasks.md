# Tasks: Offline zip release

**Input**: Design documents from `/specs/004-offline-zip-release/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/launcher.md, contracts/zip-layout.md, quickstart.md

**Tests**: Included. The constitution (Principle VIII) requires tests for the logic, and the spec requires an automated offline test (FR-014). Write each test first and see it fail.

**Organization**: By user story. Stories 1 and 2 are P1; stories 3 and 4 are P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 run offline, US2 prove nothing leaves, US3 publish a release, US4 open it the right way
- Paths are from the repository root

---

## Phase 1: Setup

- [x] T001 Set `package.json` version to `0.2.0`; add scripts `release` (`npm run build && node scripts/build-release.mjs`), `verify:release` and `test:e2e:offline`; add `release-out/` to `.gitignore`
- [x] T002 [P] Version constants: `define` `__APP_VERSION__` (from `package.json`) and `__SPEC_VERSION__` (from `SPEC_VERSION`) in `vite.config.ts` for the build and for Vitest, with their types in `src/vite-env.d.ts`, and `src/app/version.ts` exporting `APP_VERSION`, `SPEC_VERSION` and `versionLabel()` (`v0.2.0 · writes spec v3`) (R6)

---

## Phase 2: Foundational (blocks all stories)

- [x] T003 [P] Unit tests for the release library in `tests/unit/release-lib.test.ts`: file stem from versions, checksum lines (format, sort order, LF), parsing them back, tag-to-version check, file collection sorted by path with forward slashes, refusal of paths outside the folder
- [x] T004 [P] Unit tests for the reproducible zip writer in `tests/unit/release-zip.test.ts`: same inputs give equal bytes, entries sorted, fixed timestamps (`SOURCE_DATE_EPOCH`), readable by the app's own `readZipDirectory` and by Python's `zipfile` when available, deflate and stored entries, names with spaces and non-ASCII
- [x] T005 Write `scripts/release-lib.mjs` (stem, checksums, tag check, collect) to pass T003
- [x] T006 Write `scripts/zip-writer.mjs` (sorted, fixed time, `node:zlib` deflate level 9, UTF-8 names, CRC-32) to pass T004
- [x] T007 [P] Write `scripts/licenses.mjs` (generated into the zip at build time, not committed, so it cannot drift): the app's MIT licence, the licence text of each bundled component found in `node_modules` (DuckDB-WASM, React, word lists, fonts, icons) and the Excel extension's notice; fail if a bundled component has none; unit test in `tests/unit/release-licenses.test.ts` (R11)

**Checkpoint**: the pieces that build a zip exist and are tested.

---

## Phase 3: User Story 1 - Run it from a folder with no internet (Priority: P1) 🎯 MVP

**Goal**: unzip, start the launcher, and do a full CSV and Excel session offline, with output identical to the hosted site.

**Independent Test**: `npm run release`, then `npx playwright test offline-zip` (unzips the built zip into a folder with a space, starts the real launcher, runs both sessions with non-local requests failing).

- [x] T008 [P] [US1] End-to-end test `tests/e2e/offline-zip.spec.ts`: unzip the built zip into a temporary folder with a space in its name, start the launcher with `--no-open`, read its `URL:` line, route every request so anything not to that origin fails and is recorded, run a full CSV session and a full Excel session (load, review, generate, download, spec save), and expect every request to be to that origin
- [x] T009 [P] [US1] Same-output test in `tests/e2e/offline-zip.spec.ts`: generate from one spec and seed on the offline copy and on the `vite preview` copy of `dist/` and compare the files' content (CSV bytes; workbook cells read back), per FR-002 and SC-003
- [x] T010 [US1] Write `release/launcher/start.ps1` per `contracts/launcher.md`: `HttpListener` on `127.0.0.1`, first free port from 8731, explicit content types, `Cache-Control: no-store`, GET and HEAD only, files under `site/` only, `--no-open`, `--port`, the `URL:` line, exit codes 2 and 3; and `release/launcher/start.cmd` (double-click wrapper using `powershell -NoProfile -ExecutionPolicy Bypass -File`, window stays open on error)
- [x] T011 [P] [US1] Write `release/launcher/start.sh`: `python3 -m http.server --bind 127.0.0.1 --directory site` from the script's folder, the same options, the `URL:` line, exit codes 2, 3 and 4 with the message naming the Windows launcher and the hosted site; mark it executable in the zip
- [x] T012 [US1] Write `scripts/build-release.mjs`: take `dist/` unchanged into `site/APP-synthetic-data-generator/`, add `start.cmd`, `start.ps1`, `start.sh`, `LICENSES.md` and `README.txt` (from the template with version and the build date from `SOURCE_DATE_EPOCH` or the commit date, never the clock), write `CHECKSUMS.sha256` last, write `release-out/<stem>.zip` and a copy of the checksum file, using the library and zip writer
- [x] T013 [P] [US1] Write `release/README.template.txt` (one page): steps for Windows, macOS and Linux, supported browsers, the version, how to verify the checksums (`Get-FileHash` and `shasum -a 256 -c`), how to stop the launcher, how to confirm nothing leaves the machine (the counter and the browser's network tool), what to do if a policy blocks the script, and a plain statement that the launcher is an extra step and why (R1, R3)

**Checkpoint**: a built zip runs fully offline and matches the hosted site.

---

## Phase 4: User Story 2 - A tester can prove nothing leaves the machine (Priority: P1)

**Goal**: version visible, counter at zero, every file checkable, no outside address anywhere in the zip.

**Independent Test**: `node scripts/verify-release.mjs <zip>` passes on a good zip and fails on each bad one; the page shows the version; the offline test shows zero outside requests.

- [x] T013a [US2] Record the scan of the real `dist/` (hosts found and where each comes from) in `research.md` R8 and as the verifier's allowlist data in `scripts/release-allowlist.json`, so T014 and T015 test against facts
- [x] T014 [P] [US2] Unit tests for the verifier in `tests/unit/release-verify.test.ts` using small zips built in the test: passes a good zip; fails on an extra file (a source map, `.env`, a fixture), a missing file, a changed file, a file missing from the checksum list, a new outside `http(s)` host in a text file (every host on the allowlist accepted, any other rejected), a version mismatch between zip name, README and `site/` build, and a missing content policy tag in `index.html`
- [x] T015 [US2] Write `scripts/verify-release.mjs` per R8 and `contracts/zip-layout.md` to pass T014; print each failure with the file and the reason, exit 1; run from `npm run verify:release`
- [x] T016 [P] [US2] Component test `tests/component/version-display.test.tsx`: the header shows `v0.2.0 · writes spec v3` (from the constants), the help guide repeats it, nothing else changes
- [x] T017 [US2] Show the version label in `src/app/AppHeader.tsx` and in `src/app/HelpGuideModal.tsx`, styled with existing classes
- [x] T018 [US2] Extend `tests/e2e/offline-zip.spec.ts`: after a full session the in-app counter shows zero cross-origin requests; every file in the unzipped folder matches `CHECKSUMS.sha256`; trying the machine's non-loopback address on the launcher's port is refused; no cookie is set and local, session and IndexedDB storage hold nothing after a session (FR-007, FR-016, SC-002, SC-004)

**Checkpoint**: the claim "nothing leaves the machine" is checkable by a tester and by CI.

---

## Phase 5: User Story 3 - A maintainer publishes a release (Priority: P2)

**Goal**: a version tag builds, verifies, tests and publishes the zip; a local build of the same commit matches.

**Independent Test**: build twice and compare; run the workflow on a test tag or with `workflow_dispatch` in dry-run mode.

- [ ] T019 [P] [US3] Unit test `tests/unit/release-tag.test.ts` for `scripts/check-tag.mjs`: `v0.2.0` passes against version `0.2.0`; `v0.2.1`, `0.2.0` and `v0.2.0-rc1` fail with the reason (the last allowed only in dry-run mode)
- [ ] T020 [US3] Write `scripts/check-tag.mjs` to pass T019
- [ ] T021 [P] [US3] Reproducibility test `tests/e2e/release-reproducible.spec.ts` (or a script check in the workflow): run `build-release` twice on one `dist/` and expect equal checksum lists and equal zip bytes (FR-012, SC-004)
- [ ] T022 [US3] Write `.github/workflows/release.yml`: on `v*` tags and `workflow_dispatch` (dry run: build, verify and test but do not publish): checkout, Node 24, `npm ci`, lint, typecheck, unit tests, `npm run build`, bundle and extension checks as in `deploy.yml`, `check-tag`, `build-release`, `verify-release`, then the offline test on `ubuntu-latest` and `macos-latest` (`start.sh`) and `windows-latest` (`start.ps1`) using the built zip as an artifact, then `gh release create` with the zip and `CHECKSUMS.sha256`, named `v<app> (writes spec v<N>)`
- [ ] T023 [P] [US3] Document the release steps in `README.md` (bump version, tag, what the workflow does, how to build locally and compare)

**Checkpoint**: a tag produces a verified release.

---

## Phase 6: User Story 4 - Open it the right way (Priority: P2)

**Goal**: a wrong way of opening gives a message; the launcher behaves in edge cases; the supported browsers work.

**Independent Test**: open `index.html` from disk in Chromium, Firefox and WebKit and see the message; run the launcher edge tests; run the offline test in the other browsers.

- [x] T024 [P] [US4] Write `public/guard.js` (classic script, no module, no inline code): when `location.protocol` is `file:`, write a short message into `#root` (what happened, use `start.cmd` or `start.sh`, see `README.txt`); do nothing when served; add `<script src="./guard.js"></script>` to `index.html` and confirm the build keeps it and the hosted site is unchanged (R5)
- [x] T025 [P] [US4] Test `tests/e2e/offline-guard.spec.ts`: open the built `index.html` with `file://` in Chromium, Firefox and WebKit and expect the message and no blank page; open it served and expect no message; the message has no accessibility violation (axe)
- [x] T026 [P] [US4] Launcher edge tests in `tests/e2e/offline-zip.spec.ts`: a folder path with spaces; a second launcher while the first runs takes the next port and the first keeps serving; `--port` on a taken port exits 2; a path with `..` and a missing file give 404; POST gives 405; `site/` missing gives exit 3; the launcher leaves no file behind; every response carries `Cache-Control: no-store` (FR-015)
- [x] T027 [US4] Add `offline-zip` and `offline-guard` to the Firefox and WebKit `testMatch` in `playwright.config.ts` and to `scripts/e2e-browsers.mjs`; run in Chromium, Edge (`PW_EDGE=1`), Firefox and WebKit and fix what differs

**Checkpoint**: every way of opening ends in a working app or a message that says what to do.

---

## Phase 7: Polish and Cross-Cutting

- [ ] T028 [P] Add an "Offline copy" section to `README.md` (what it is, how to get it, that a launcher is needed and why, the version pairing) and a short entry in the Help guide
- [ ] T029 [P] Measure and record in `research.md`: zip size against `dist/`, unzip and open time on the reference laptop (SC-007), and the launcher's start time
- [ ] T030 Run a dry-run of `release.yml` with `workflow_dispatch` on `main`, fix what it finds, record the run in `research.md`; the first real release is the maintainer's tag
- [ ] T031 Run quickstart scenarios A to D locally, and record the results and the person sign-off line (SC-008: someone other than the author follows `README.txt` alone on a clean Windows machine) in `quickstart.md`
- [ ] T032 Run `/speckit-converge` and mark the slice complete

---

## Dependencies and order

- Phase 1, then Phase 2 (T003 and T004 before T005 and T006). All stories need Phase 2.
- US1 is the MVP: T008 and T009 first (they fail), then T010, T011, T012 and T013.
- US2 needs the zip from US1 for T018; T014 to T017 can run beside US1.
- US3 needs T012 and T015 (build and verify) and T008 for the workflow's offline step.
- US4 needs the launcher (T010, T011) for T026 and T027; T024 and T025 are independent.
- Polish last.

## Parallel examples

- After Phase 2: T008, T009, T011 and T013 are different files; T014 and T016 beside them.
- US4: T024, T025 and T026 beside each other.

## Implementation strategy

MVP first: Phases 1 to 3 give an analyst a working offline zip. Then US2 makes the privacy claim
checkable, US3 automates publishing, US4 hardens opening. Commit after each task group.
