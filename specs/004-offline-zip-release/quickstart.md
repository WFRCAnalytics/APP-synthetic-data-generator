# Quickstart: Offline zip release

## Prerequisites

Node 24, `npm ci`, a built `dist/` (`npm run build`). Playwright browsers for the end-to-end scenarios.

## Scenario A: build and verify (User Story 3)

1. `npm run release` (builds `dist/`, then the zip and `CHECKSUMS.sha256` into `release-out/`).
2. `node scripts/verify-release.mjs release-out/synthetic-data-generator-<v>-spec<N>-offline.zip`.
3. Run step 1 twice: **Expect** equal checksum lists and equal zip bytes.

**Expect**: verify passes; the file list is exactly the contract; the versions agree.

## Scenario B: run it offline (User Stories 1, 2, 4)

1. Unzip into a folder with a space in its name. Disconnect the network.
2. Windows: double-click `start.cmd`. macOS or Linux: `./start.sh`.
3. Load a CSV and an Excel workbook, review, generate, download the fake file and the spec.

**Expect**: everything works; the page shows `v<app> · writes spec v<N>`; the in-app counter shows zero outside requests; the same spec and seed as on the hosted site give identical content.

## Scenario C: opened the wrong way

1. Open `site/APP-synthetic-data-generator/index.html` by double-click.

**Expect**: a short message that says to use `start.cmd` or `start.sh`, no blank page.

## Scenario D: loopback only

1. With the launcher running, from another computer on the network, open `http://<this machine's address>:8731/`.

**Expect**: connection refused. `npx playwright test offline-zip` checks the same locally.

## Scenario E: the release

1. Tag `v<app>` equal to `package.json`'s version and push the tag.

**Expect**: the workflow gates pass, the offline test passes on Linux and Windows, and the release holds the zip and `CHECKSUMS.sha256`, named with both versions. A mismatched tag fails the workflow.

## Done when

Scenarios A to D pass locally, E passes on a real tag, and `tasks.md` has no unchecked task. A person other than the author follows `README.txt` alone on a clean Windows machine (SC-008).

## Results (recorded 2026-10-31)

| Scenario | Result | Evidence |
|----------|--------|----------|
| A: build and verify | pass | `npm run release`, `verify-release` (48 files); two builds equal (`release-reproducible.test`); local and workflow builds have identical checksums (research R14) |
| B: run offline | pass in Chromium, Edge, Firefox, WebKit (Windows launcher); Linux and macOS in CI (Chromium) | `offline-zip.spec`: full CSV and Excel sessions with every non-launcher request refused, zero cross-origin requests, no cookie or storage, output equal to the hosted build's |
| C: opened the wrong way | pass in Chromium, Edge, Firefox, WebKit, light and dark, no axe violation | `offline-guard.spec` |
| D: loopback only | pass | `offline-zip.spec` (other address gets no page), launcher edge cases (ports, traversal, methods, missing `site/`, exit codes) |
| E: the release | dry run passes (research R14); first real tag is the maintainer's | `release.yml` |

**Still for a person** (an automated run cannot stand in): SC-008, someone other than the author follows
`README.txt` alone on a clean Windows machine and reaches a working app, and SC-001 (under 5 minutes). The
first real release is made by pushing the tag `v0.2.0`.

