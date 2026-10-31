# Research: Offline zip release

## R1: Can the app open straight from disk?

- **Decision**: No. Ship a launcher.
- **Evidence** (spike, 2026-10-31, a build with relative paths opened by `file://` in Playwright):
  Chromium and WebKit refuse the module script and the stylesheet ("from origin 'null' has been
  blocked", "Origin null is not allowed by Access-Control-Allow-Origin") and show a blank page.
  Firefox loads the page but "error in duckdb worker: NetworkError" stops profiling at once.
  Module scripts, module workers and WebAssembly loading all need an origin, so this cannot be
  fixed inside the page without lowering browser security flags, which the spec forbids.
- **Alternatives considered**: a single-file build with everything inlined (the content policy
  forbids inline scripts, the DuckDB binaries are about 12 MB and workers cannot start from
  `file:`); a browser flag such as `--allow-file-access-from-files` (unsafe, per-browser, not
  for analysts); installing Node (forbidden by the spec).

## R2: Same `dist/`, same path

- **Decision**: The zip holds the hosted `dist/` byte for byte under
  `site/APP-synthetic-data-generator/`, and the launcher serves `site/` at its root, so every
  address the build produced still resolves (`import.meta.env.BASE_URL`, worker and extension
  URLs). No second build, no relative-base build.
- **Rationale**: A relative-base build also breaks worker URLs (a worker resolves `./duckdb/`
  against its own script) and would be a different artifact than the one tested. Identical bytes
  make FR-002 and SC-003 follow from the existing tests.

## R3: The launcher, per platform

- **Decision**:
  - **Windows**: `start.cmd` (double-click) runs `start.ps1` with `powershell -NoProfile
    -ExecutionPolicy Bypass -File`. The bypass is for that one process only and changes no
    setting. `start.ps1` uses `System.Net.HttpListener` on `http://127.0.0.1:<port>/`, which needs
    no administrator rights for loopback and no install. If a policy blocks the script, the README
    says to ask IT and names the alternative (`start.sh` with Python, or the hosted site).
  - **macOS and Linux**: `start.sh` runs `python3 -m http.server --bind 127.0.0.1 --directory site`
    (both ship with the OS or developer tools; the README says so).
  - Both pick the first free port from 8731 upward, print one line `URL: http://127.0.0.1:<port>/APP-synthetic-data-generator/`, open the default browser unless `--no-open`, send `Cache-Control: no-store`, and stop on Ctrl+C or when the window closes.
- **Rationale**: FR-007. Loopback binding means other computers get a refused connection. HttpListener
  and `http.server` need nothing to be installed. The test reads the printed line, so it works the
  same for both.
- **Alternatives considered**: a bundled executable (needs code signing to avoid warnings, out of
  scope); a Node single-file binary (large, unsigned); `python -m http.server` on Windows (Python
  is not installed by default).

## R4: MIME types and headers

- **Decision**: The PowerShell server maps `.js`, `.mjs` to `text/javascript`, `.wasm` to
  `application/wasm`, `.css`, `.json`, `.png`, `.woff`, `.svg`, `.txt` explicitly (Windows' registry
  types are not reliable for these), serves only files under `site/`, rejects `..` and any other
  path with 404, and answers only GET and HEAD. Python's `http.server` already knows these.
- **Rationale**: a wrong type for `.js` or `.wasm` fails silently in a browser, and path traversal
  must not be possible even on loopback.

## R5: Message when opened from disk

- **Decision**: `public/guard.js`, a classic script with a relative `src` (`./guard.js`) in
  `index.html`. Classic scripts without `crossorigin` do load from `file:`, so it runs where the
  module script is blocked. If `location.protocol === "file:"` it writes a short message into the
  page (what happened, "open `start.cmd`", the README name). On a served page it does nothing. It
  makes no request and holds no inline code, so the content policy is unchanged.
- **Rationale**: FR-008, SC-006. This is the only way to avoid a blank page.

## R6: Version stamp

- **Decision**: `package.json` `version` is the app version. Vite `define` exposes
  `__APP_VERSION__` and the spec version (from `SPEC_VERSION`) as constants. The header shows
  `v0.2.0 · writes spec v3` and the help guide repeats it. The zip, the release and `README.txt`
  carry the same pair (`synthetic-data-generator-0.2.0-spec3-offline.zip`); `verify-release`
  fails if they disagree. The first release bumps the version to 0.2.0.
- **Rationale**: FR-009, FR-010, SC-005.

## R7: Reproducible zip

- **Decision**: `build-release.mjs` collects files, sorts them by path, writes entries with a fixed
  modification time (`SOURCE_DATE_EPOCH` or 2026-01-01), fixed attributes and deflate level 9 via
  `node:zlib`, and writes `CHECKSUMS.sha256` (sha256, relative path, sorted, LF) last. Two builds of one
  commit give the same checksum list, and the zip bytes are equal as well.
- **Rationale**: FR-012, SC-004. A local build can be compared with the release asset.

## R8: Verification of the built zip

- **Decision**: `verify-release.mjs` opens the zip and checks: the expected file set (no extra
  files: no maps with paths, fixtures, `.env`, tokens or `node_modules`), every file in
  `CHECKSUMS.sha256`, the versions agree, no text file in `site/` contains an `http://` or `https://`
  address other than the allowed list (the XML namespace strings and licence links in comments,
  listed in the script with the reason), and `index.html` has the strict content policy meta tag.
- **Rationale**: FR-013, FR-004, FR-005. The check runs on the zip, not on `dist/`, so it tests what
  ships.

## R9: The offline test

- **Decision**: `tests/e2e/offline-zip.spec.ts` unzips the built zip into a temporary folder whose
  name has a space, starts the real launcher with `--no-open`, reads its `URL:` line, opens the page
  with Playwright and routes every request: anything not to that origin fails the test and is
  recorded. It runs a full CSV session and a full Excel session, generates, compares the output with
  a generation of the same spec and seed from the `vite preview` copy, and checks that the in-app
  counter shows zero cross-origin requests. It also tries to connect to the machine's non-loopback
  address and expects refusal, and opens the folder with `file://` to expect the guard message.
- **Rationale**: FR-014, FR-005, FR-007, FR-008, SC-002, SC-003.

## R10: Release workflow

- **Decision**: `release.yml` runs on tags `v*`: lint, typecheck, tests, build, the bundle and
  extension checks (as `deploy.yml`), `build-release.mjs`, `verify-release.mjs`, then the offline
  test on `ubuntu-latest` (`start.sh`) and `windows-latest` (`start.ps1`), then creates the release
  with the zip and `CHECKSUMS.sha256` using the `gh` CLI. The release name is `v0.2.0 (writes spec v3)`.
  The tag must equal `package.json`'s version, or the workflow fails.
- **Rationale**: FR-010, FR-011, SC-005.

## R11: Licence notices

- **Decision**: `scripts/licenses.mjs` writes `LICENSES.md` from `LICENSE` (MIT) and the licence
  files of the bundled components found in `node_modules` (DuckDB-WASM, React, faker word lists,
  fonts, icons) plus a fixed paragraph for the DuckDB Excel extension (MIT, from the extension
  repository's licence). The build fails if a component in the bundle has no licence text.
- **Rationale**: FR-003. Bundled components' licences require the notice to travel with them.

## R12: Cache and version mixing

- **Decision**: `Cache-Control: no-store` from the launcher, and the build's hashed asset names,
  keep two versions from mixing; `index.html` shows the version so a stale tab is visible.
- **Rationale**: FR-015.

## Open items

None.
