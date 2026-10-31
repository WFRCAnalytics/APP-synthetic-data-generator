# Data Model: Offline zip release

No app data changes; the spec file stays at version 3. These are the release artifacts.

## Version stamp

| Field | Source | Notes |
|-------|--------|-------|
| `appVersion` | `package.json` `version` | semver, for example `0.2.0`; equals the git tag without `v` |
| `specVersion` | `SPEC_VERSION` in `src/lib/spec/types.ts` | integer, 3 today |
| label | derived | `v0.2.0 · writes spec v3` in the header and help guide |
| file stem | derived | `synthetic-data-generator-0.2.0-spec3-offline` |

Rule: all four places agree (release name, zip name, `README.txt`, page). `verify-release` enforces it.

## Release manifest (`CHECKSUMS.sha256`)

One line per file, sorted by path, LF endings: `<64 hex sha256>  <relative path>`. It lists every
file in the zip except itself. The verifier fails on a missing, extra or changed file.

## Launcher state

None kept. Per run: chosen port (first free from 8731), the folder served (`site/`), the printed
`URL:` line.

## Zip contents

See [contracts/zip-layout.md](contracts/zip-layout.md).
