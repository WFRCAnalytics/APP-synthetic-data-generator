# Contract: zip layout

Name: `synthetic-data-generator-<app>-spec<N>-offline.zip`, for example `synthetic-data-generator-0.2.0-spec3-offline.zip`. One top folder with the same stem.

```text
synthetic-data-generator-0.2.0-spec3-offline/
├── README.txt                 # one page: open it, browsers, version, verify, stop, confirm no network
├── CHECKSUMS.sha256           # sha256 of every other file
├── LICENSES.md                # app and bundled components
├── start.cmd                  # Windows, double-click
├── start.ps1                  # Windows launcher (HttpListener, loopback only)
├── start.sh                   # macOS and Linux launcher
└── site/
    └── APP-synthetic-data-generator/     # the unchanged dist/: index.html, guard.js, assets/, duckdb/, duckdb-ext/
```

Allowed in the zip: exactly the above (the files under `site/` are `dist/`'s, including the Excel
extension and the word lists inside the worker bundle). Not allowed: source maps, `.env`, tokens,
fixtures, `node_modules`, `test-results`, spike pages, any file not in `CHECKSUMS.sha256`.

Checksum line format: `<sha256 hex>␣␣<path relative to the top folder, forward slashes>`.

Reproducibility: entries sorted by path, modification time fixed to `SOURCE_DATE_EPOCH` (default 2026-01-01T00:00:00Z), deflate level 9, no extra fields, UTF-8 names.
