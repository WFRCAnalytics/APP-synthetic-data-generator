# Implementation Plan: Offline zip release

**Branch**: `004-offline-zip-release` | **Date**: 2026-10-31 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-offline-zip-release/spec.md`

## Summary

The release zip carries the same `dist/` the hosted site serves, unchanged, under the same
`/APP-synthetic-data-generator/` path, so behaviour is identical (FR-002) and nothing is rebuilt
for offline use. Opening straight from disk cannot work (spike, research R1: Chromium and WebKit
refuse the module script from origin `null`; Firefox loads the page but the DuckDB worker fails),
so the zip ships a small launcher that serves the folder on `127.0.0.1` only, using what the
operating system already has: PowerShell on Windows (`System.Net.HttpListener`), and `python3`
or the system's own tools on macOS and Linux. A classic `guard.js` shows a plain message if the page is
opened from disk. A build script writes the zip with fixed order and timestamps plus a checksum
list; a verifier checks the zip's contents and that no file references an outside address; a
Playwright test runs the real launcher against the unzipped folder with every non-local request
failing. A tag workflow runs the same gates as the hosted deploy, builds the zip, verifies it
and attaches zip and checksum to the release. The page shows the app and spec versions from the
build.

## Technical Context

**Language/Version**: TypeScript 5.9 strict and Node 24 for tooling; PowerShell 5.1 (the version Windows ships) and POSIX shell with `python3` for the launcher

**Primary Dependencies**: nothing new at runtime. The build script writes the zip with Node's own `zlib` (no archive package). The launcher uses only the operating system.

**Storage**: none; the zip is a build artifact

**Testing**: Vitest (manifest, version, verifier), Playwright (Chromium; launcher end to end, blocked network), a Windows CI job for the PowerShell launcher

**Target Platform**: Windows 10/11 with current Chrome or Edge first; Firefox and WebKit where the hosted site is tested; the launcher also runs on macOS and Linux

**Project Type**: single-page web app plus release tooling (scripts and a workflow)

**Performance Goals**: unzip and open in under 30 seconds on an office laptop (SC-007); the launcher starts in under 3 seconds

**Constraints**: no request outside the machine or outside the zip's own files; launcher listens on loopback only; no developer tool needed; no browser or OS setting lowered; strict content policy unchanged

**Scale/Scope**: one zip of about the size of `dist/` (about 12 MB with the DuckDB binaries and the Excel extension) plus a few small files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status |
|-----------|--------|
| I. Privacy first | Pass. The launcher serves files only and opens no outbound connection; the same content policy and request counter apply; a test fails on any non-local request. |
| II. Minimal derived artifact | Not affected (no spec change). |
| III. Client-only static deployment | Pass, and this slice delivers its required offline zip. Build output is still not committed; the zip is a release asset. Same pinned engine and extension files. |
| IV. Format fidelity | Not affected. |
| V. Reproducibility | Pass. Same spec and seed give identical content offline (tested); the zip build is reproducible (fixed order and times). |
| VI. User control and transparency | Pass. The README says plainly that a launcher exists, what it does and how to stop it; the page shows its version. |
| VII. Brand and accessibility | Pass. The version line and the "opened from disk" message use existing styles and are checked by the accessibility test. |
| VIII. Test-driven correctness core | Pass. Manifest, verifier and version logic are unit tested; the launcher is tested end to end. |
| IX. Scale and performance | Not affected. |
| X. Vertical slices | Pass. Each user story is testable alone; progress is tracked in `tasks.md`. |

Dependencies: none added. Re-check after design: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/004-offline-zip-release/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── launcher.md          # command line, output line, exit codes, loopback rule
│   └── zip-layout.md        # files in the zip, checksum list format, naming
├── checklists/requirements.md
└── tasks.md                 # /speckit-tasks
```

### Source Code (repository root)

```text
index.html                         # + <script src="./guard.js"> (classic, no module)
vite.config.ts                     # + define __APP_VERSION__ / __SPEC_VERSION__ from package.json and spec types
public/guard.js                    # classic script: message when opened from file://
release/
├── launcher/
│   ├── start.cmd                  # double-click wrapper for Windows
│   ├── start.ps1                  # HttpListener on 127.0.0.1, picks a free port, opens the browser
│   └── start.sh                   # macOS and Linux (python3 http.server bound to 127.0.0.1)
├── README.template.txt            # one page; version and date filled in at build
└── LICENSES.md                    # app (MIT), engine, Excel reader, word lists, fonts, icons
scripts/
├── build-release.mjs              # dist + launcher + docs -> zip and CHECKSUMS.sha256 (reproducible)
├── verify-release.mjs             # file list, no extra files, no outside address, versions agree
└── licenses.mjs                   # collects bundled components' license text for LICENSES.md
src/app/version.ts                 # APP_VERSION, SPEC_VERSION re-export, label()
src/app/AppHeader.tsx              # + version line (and in HelpGuideModal)
.github/workflows/release.yml      # tag v*: gates, build, verify, offline test (Linux and Windows), attach assets
tests/
├── unit/{release-manifest,version,release-verify}.test.ts
├── component/version-display.test.tsx
└── e2e/offline-zip.spec.ts        # unzip, run the real launcher, block non-local requests, full CSV and Excel session, identical output, loopback only
```

**Structure Decision**: the release is tooling around the existing app, so the code lives in `scripts/`, `release/` and one workflow; the app gains only a version module, a header line and one classic script. The zip contains the unchanged `dist/` under `site/APP-synthetic-data-generator/`, which is why the hosted and offline copies behave the same and why no offline-specific build exists.

## Complexity Tracking

No constitution violations. Two choices that look like extra work, with the reason:

| Choice | Why needed | Simpler alternative rejected because |
|--------|------------|--------------------------------------|
| A launcher in the zip | Opening from disk fails in all three engines (R1) | Telling analysts to lower browser security flags is unsafe and unsupported |
| Own zip writer in `scripts/` | Reproducible zips (fixed order and times) with no new package | A zip package adds a dependency and hides ordering and timestamps |
