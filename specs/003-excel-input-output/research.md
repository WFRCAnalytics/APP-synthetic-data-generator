# Research: Excel Input and Output

**Feature**: 003-excel-input-output

## Spike results (2026-10-31)

Run with `npx playwright test spikes/excel.spec` on a built `--mode spike` page, under the strict
content policy, with a 18 KB workbook made by `xlsxwriter` that has: a hidden sheet, a title row and
an empty row above the header, text with leading zeros, numbers stored as text, numbers with
`#,##0.00`, percent and `mm/dd/yyyy` formats, blank cells, cells holding empty text, formulas with
cached values, and merged cells.

| Question | Result |
|---|---|
| Does the Excel extension exist for this engine's WebAssembly builds? | Yes: DuckDB v1.5.4, `wasm_eh` (594 KB) and `wasm_mvp` (560 KB), at `extensions.duckdb.org/v1.5.4/<platform>/excel.duckdb_extension.wasm` |
| Does a self-hosted copy load under `connect-src 'self'`? | Yes. With `custom_extension_repository` set to the site's own folder and `LOAD excel`, it loaded; 0 policy violations; 0 requests outside the site |
| Can it read from a browser `File` without copying it into JS memory? | Yes (`registerFileHandle` with the file reader protocol, as for CSV) |
| `range = 'A3:I203'` with `header = true` | Skips the rows above the table and reads the table: 200 rows, names from row 3 |
| Types without `all_varchar` | Leading-zero text and numbers stored as text: VARCHAR (zeros kept). Numbers: DOUBLE. Date cells: DATE. Blank cells: NULL. Empty-text cells: '' (told apart from blanks: 20 NULL scores, 14 empty flags) |
| Formulas | Read as cached values (`total` = 2 x `amount`), no formula text |
| `all_varchar = true` | Dates come back as serial numbers ("45292") and numbers as "1000", "2000.0": loses the date type and adds ".0" |
| Without a range, `header = false` | Reads one column ("A1"): the width comes from the first row, so rows above the table need a range |
| DuckDB's xlsx writer (`COPY ... TO 'x.xlsx' (FORMAT xlsx)`) | Writes a valid file (3.7 KB), but has no option for number formats or for blank versus empty text |
| Can the Node test engine load the extension? | No. `LOAD` fails there ("The object does not support the operation or argument"), because WebAssembly extensions need the browser build. Everything that calls `read_xlsx` is therefore tested in a real browser; the SQL that builds it and the conversion to text are tested in Node on synthetic typed tables |
| What DuckDB does not give | Sheet names and visibility, the date system, the number format of a column, merged cells, a suggested number of rows to skip |

## R1: Reading approach

- **Decision**: DuckDB's Excel extension reads the data; a small own reader of the workbook package
  supplies what the extension does not (sheet list, visibility, date system, number formats, hints).
  SheetJS is not used.
- **Rationale**: The spike shows the extension covers every data quirk in the spec, runs in the
  worker without a copy of the file, and fits the privacy model. The missing pieces are metadata, not
  data: they come from three small XML parts of the package, never from cell values.
- **Alternatives**: SheetJS (about 1 MB more code, parses everything into JS objects, so memory is
  much worse for large sheets); reading all cells with a streaming parser of our own (slower than the
  extension and a lot more code).

## R2: Serving the extension

- **Decision**: `scripts/fetch-extensions.mjs` runs before dev and build. It asks the pinned engine
  for `SELECT version()` (so a new DuckDB-WASM version picks the matching extension by itself),
  downloads `excel` for `wasm_eh` and `wasm_mvp` from the official host into
  `public/duckdb-ext/<engine version>/<platform>/`, checks the size and the WebAssembly magic bytes,
  and records the files and sha-256 sums in `VERSION.json` beside them. The folder is gitignored.
  The page sets `custom_extension_repository` to its own address and loads the extension by name.
  `autoinstall` and `autoload` stay off.
- **Rationale**: Principle III; also answers the user's earlier question about a new DuckDB version.
  Build time is the only moment anything is fetched from outside.
- **Alternatives**: committing the binaries (versioned blobs in git); a CDN at run time (forbidden).

## R3: All-text table from a typed read

- **Decision**: Read the sheet with types, then convert each column to text in SQL so that the rest
  of the pipeline (which works on an all-text `src` table) is unchanged: DATE to `YYYY-MM-DD`,
  TIMESTAMP to `YYYY-MM-DD HH:MM:SS`, TIME to `HH:MM:SS`, whole DOUBLE values without ".0",
  other DOUBLE values as shortest round-trip text, BOOLEAN to `TRUE` or `FALSE`, VARCHAR as it is.
  A blank cell is NULL, as an empty CSV field is.
- **Rationale**: Dates must be dates (the spike shows `all_varchar` loses them) and numbers must not
  gain ".0". Everything after loading is identical to CSV, so all of slices 1 and 2 apply.
- **Alternatives**: `all_varchar` plus own conversion with the number formats (more code, and
  serial numbers need the date system); changing the profiler to typed columns (a rewrite).

## R4: Blank versus empty text

- **Decision**: Empty-text cells become the reserved token `EMPTY_TEXT_TOKEN` in the text table and
  count as one more NA token (so profiling counts them separately from blanks). The spec records
  them as that token in `na.tokens` and `na.by_token`. Excel output writes the token as an
  empty-string cell and blank as no cell; CSV output writes both as an empty field.
- **Rationale**: The existing NA machinery (tokens, exact counts, random placement) does all the
  work; only the writer needs to know the token.
- **Alternatives**: a separate count field (a second placement path).

## R5: Number formats

- **Decision**: One format code per column, taken from the cell style of the first non-blank data
  cells in the table (the head of the sheet XML, a bounded read). `formats.ts` classifies a code as
  date, time, datetime, number, percent, currency, scientific or text, and extracts decimals and the
  thousands flag. These feed the existing numeric `decimals` and `thousands` fields and the date
  column's display format. The spec stores the code (`cell_format`), for example `#,##0.00`.
  Built-in format ids (0 to 49) are mapped to their codes.
- **Rationale**: The format a column displays is what code that reads text or dates depends on.
  A bounded read keeps the cost small, and the styles are consistent down a column in practice.
- **Alternatives**: scanning every cell (full pass of the sheet XML in JavaScript).

## R6: Dates

- **Decision**: Dates are read by the extension (DATE, TIMESTAMP) and kept as ISO text inside the
  pipeline; the spec's date column uses an ISO pattern (`%Y-%m-%d` or with time) and `cell_format`
  holds the Excel display code. The writer converts ISO text to a serial number (`serial.ts`) in the
  workbook's date system (1900 with the 1900 leap-year quirk, or 1904) and writes it with the
  display format. The date system is read from `workbookPr` and stored as `date1904`.
- **Rationale**: Keeps one date machinery (slice 1) and moves Excel specifics to the edges.
- **Alternatives**: Excel-specific date patterns inside the generator (a second formatter).

## R7: Writing the workbook

- **Decision**: Own writer. Parts: `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml` (sheet name,
  date system), `xl/_rels/workbook.xml.rels`, `xl/styles.xml` (one style per distinct format code,
  plus a text style), `xl/worksheets/sheet1.xml` (rows as chunks), no shared strings (inline strings,
  `t="inlineStr"`) so rows can stream. A streaming zip writer emits entries with data descriptors;
  each entry is deflated through `CompressionStream("deflate-raw")`; CRC-32 is computed as bytes pass.
  Rows above the header are written empty. Numbers are numeric cells with the column's style; text
  columns are inline-string cells with the text style when the real column had leading zeros or was
  text; dates are numeric serials with the display style; EMPTY_TEXT_TOKEN is an empty inline string.
- **Rationale**: DuckDB's writer cannot do styles or the blank/empty distinction (spike). Streaming
  keeps memory bounded for 500 MB of sheet data.
- **Alternatives**: DuckDB `COPY ... xlsx` (fails FR-006, FR-008, FR-011); SheetJS write (memory).

## R8: Size warning and the memory stop

- **Decision**: The zip directory gives the uncompressed size of the chosen sheet's XML before any
  data is read. The warning shows at 100 MB expanded and states the estimated memory need (about 2.5
  times the expanded size in the table plus the engine's working copy); the stop is at a limit
  measured by the large-workbook test and recorded here after implementation (initial value 1.2 GB
  expanded). Large workbooks never start loading past the stop.
- **Rationale**: FR-015: fail with a message before the tab dies.
- **Alternatives**: try and catch an out-of-memory error (the tab can crash instead of throwing).

## R9: Rows above the header and merged cells

- **Decision**: Suggest rows to skip as the first row whose populated cells reach at least half the
  width of the next row, read from the head of the sheet XML. Merged cells are found from the
  `<mergeCells>` block, which comes after the data; for sheets up to 300 MB expanded the XML is
  streamed through once to find it, and for larger sheets the app says merged cells were not checked.
  Merged values are read once in the top-left cell by the extension; the other cells of the merge
  are blank.
- **Rationale**: Cheap hints with a bounded cost; the user always confirms.
- **Alternatives**: a full parse of the sheet for hints (too slow on large sheets).

## R10: Other sheets and package content

- **Decision**: Only `workbook.xml`, its relationships, `styles.xml` and the chosen sheet's part are
  read. Other sheets, shared strings (except through the extension), comments, drawings and defined
  names are never opened by our code, and the extension is asked for one sheet only.
- **Rationale**: FR-003 and FR-019.

## R11: Refusals

- **Decision**: The first bytes decide the kind (PK zip signature and the presence of
  `xl/workbook.xml`), not the file name. An old .xls (OLE signature), an encrypted workbook (OLE
  signature with an `EncryptedPackage` stream) and a damaged zip each get their own message. A
  macro workbook is read like any other and macros are not run (nothing runs them).
- **Rationale**: FR-018.

## R12: Spec version

- **Decision**: `SPEC_VERSION` becomes 3, readers accept 1 to 3. Version 3 adds `source.format:
  "xlsx"` with its fields and `cell_format` on columns. A CSV spec stays valid and writes CSV (FR-020).
- **Rationale**: Same approach as slice 2.

## R13: Privacy tests

- **Decision**: A spy test records every row the engine returns while profiling a workbook whose
  other sheets, title rows and comments hold marker strings; a metadata test checks that the reader
  returns only names, flags and format codes; the e2e leak test adds a workbook; a request test
  proves no request leaves the site while the extension loads.
- **Rationale**: FR-016, FR-019, SC-003, SC-004.

## Open items

None.
