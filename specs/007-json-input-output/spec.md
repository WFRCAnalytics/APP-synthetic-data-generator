# Feature Specification: JSON input and output

**Feature Branch**: `007-json-input-output` (spec directory only; work stays on `main`)

**Created**: 2026-11-02

**Status**: Draft

**Input**: User description: "Slice 7: JSON input and output. An analyst chooses a .json file (an array of flat records) or a .ndjson/.jsonl file (one record per line). The app reads it in the browser with no request outside the site, shows only structure (record count, key names in first-seen order, the detected kind of each key), profiles it like a CSV, an Excel sheet or a Parquet file, and exports a fake file in the same form as the input with the same keys in the same order and a _fake suffix. The spec holds no values. Mixed-type keys are read as text with a warning. Nested objects and arrays are unsupported. Null and a missing key are kept as structure only. Large files get a size warning. The app is in beta, so older specs need no support."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Turn a JSON file into a fake JSON file (Priority: P1)

An analyst has a private table exported from an API or a script as a JSON array of records, such as
`[{"id": "A1", "age": 34}, ...]`. They choose the file. The app shows how many records it holds and
the key names with the kind of each, and nothing from inside the records. It profiles the file as it
does a CSV, the analyst reviews the keys, generates, and downloads a fake `.json` file that has the
same keys in the same order and is laid out the same way (indented or compact). Code that reads the
real file reads the fake one with no change.

**Why this priority**: JSON is the usual format for exports and for data handed to AI coding agents,
so it is the next most useful format after CSV, Excel and Parquet.

**Independent Test**: Load a JSON array with whole-number, decimal, text, yes/no and date keys,
accept the defaults, generate and download. Read the real and the fake file with the same code and
compare the keys, their order, and the JSON kind of each value.

**Acceptance Scenarios**:

1. **Given** a JSON array of flat records, **When** the user chooses it, **Then** the app shows the
   record count, the key names in first-seen order and the kind of each key, and shows no value.
2. **Given** a loaded file, **When** the user continues, **Then** it is profiled with the same column
   cards, types, review options and checks as a CSV.
3. **Given** a reviewed file and a seed, **When** the user generates, **Then** a preview of 50 fake
   records and the check table are shown and a fake `.json` can be downloaded, named with `_fake`.
4. **Given** the downloaded file, **When** it is read with the same code as the real file, **Then**
   it is an array of records with the same keys in the same order, and each value has the same JSON
   kind (number, string, true or false) as the real value had.
5. **Given** the same spec and seed, **When** generated twice, **Then** the two files are identical.

---

### User Story 2 - Newline-delimited JSON works the same way (Priority: P1)

Logs and data pipelines often write one record per line (NDJSON, also called JSON Lines). The analyst
chooses a `.ndjson` or `.jsonl` file, or a `.json` file that holds one record per line. The app
treats it the same as an array, and the fake file is also one record per line, so the line-by-line
tools that read the real file read the fake one.

**Why this priority**: The two forms are used about equally, and the output must match the input form
or downstream code breaks.

**Independent Test**: Load an NDJSON file, generate and download; confirm the fake file has one
complete record per line, no enclosing brackets and no commas between records.

**Acceptance Scenarios**:

1. **Given** a file with one record per line, **When** the user chooses it, **Then** it is recognised
   as NDJSON by its content, whatever its extension.
2. **Given** an NDJSON spec, **When** the fake file is written, **Then** it is NDJSON with the same
   line ending and trailing-newline habit as the real file.
3. **Given** an array file, **When** the fake file is written, **Then** it is an array, never NDJSON,
   and the other way round.

---

### User Story 3 - Null, missing and mixed keys are kept as structure (Priority: P1)

In JSON a value can be `null`, a key can be left out of a record, and one key can hold numbers in
some records and text in others. The fake file keeps how often each of these happens, without keeping
any value: a key that was sometimes `null` is sometimes `null`, a key that was sometimes missing is
sometimes missing, and a key that mixed numbers and text is read as text with a warning that says so.

**Why this priority**: Code that handles JSON checks for null and for absent keys. Collapsing the two
silently breaks that code, and guessing at mixed types would invent structure.

**Independent Test**: Load a file where one key is `null` in some records, another is absent from
some records and a third mixes numbers and text; generate and compare the counts of each case in the
real and fake files.

**Acceptance Scenarios**:

1. **Given** a key that is `null` in some records, **When** the fake file is written, **Then** the key
   is `null` in the same number of records.
2. **Given** a key that is absent from some records, **When** the fake file is written, **Then** the
   key is absent from the same number of records.
3. **Given** a key that mixes numbers and text, **When** it is profiled, **Then** it is read as text,
   a warning on its card says why, and the fake values are text.
4. **Given** a key whose values are all numbers, **When** the fake file is written, **Then** they are
   written as JSON numbers, not as quoted text.

---

### User Story 4 - Nested values are refused safely, and no real value leaks (Priority: P1)

A record can hold an object or a list inside a key. Their contents are real values of unknown shape,
so the app does not try to understand them: such keys are marked unsupported with a plain reason, can
be left out or kept as always-null, and nothing from inside them is displayed, flattened or stored.
Beyond that, no real value, and no key text beyond the key names, reaches the page, the spec, the
preview, the output file or an error message.

**Why this priority**: Nested data is the easiest place for real values to leak into a spec or a
preview, so it must be refused rather than approximated.

**Independent Test**: Load a file with an object key and a list key next to normal keys, and with
marker strings planted in values; run the whole flow; confirm the two keys are unsupported with a
reason and that no marker appears on the page, in the spec, the preview, the download, the console or
storage.

**Acceptance Scenarios**:

1. **Given** keys whose values are objects or lists, **When** the file is profiled, **Then** those keys
   are marked unsupported with a reason that names the kind (object, list) and no value.
2. **Given** an unsupported key, **When** the user generates, **Then** it is left out of the fake file
   by default, or written as `null` in every record if the user keeps it.
3. **Given** the saved spec, **When** it is read, **Then** it holds key names, kinds, null and missing
   counts and formatting only; no value, no nested key name and no text from inside a record.
4. **Given** a damaged, truncated, empty or non-JSON file, or one whose top level is not an array of
   records, **When** it is chosen, **Then** the app refuses it with a plain message that quotes no file
   content.

---

### Edge Cases

- An empty array, a file with records but no keys, or an empty file: refused with a plain message.
- An array whose items are not all objects (numbers, text or lists): refused, saying that every item
  must be a record.
- A single JSON object that is not in an array: refused with a message saying a list of records is
  needed (wrapping it is the user's choice, outside the app).
- A very wide file (hundreds of keys) and a very tall one (millions of records): handled like a wide
  or tall CSV, with progress shown.
- Keys that appear only in some records: the key order is first-seen order across the file, and the
  share of records without the key is recorded.
- Duplicate keys inside one record, and keys that are empty text: refused for duplicates with a plain
  message; empty names are renamed on the same rules as CSV headers, and the rename is shown.
- Numbers beyond exact range (above 2^53), numbers written as `1e5` and decimals such as `1.50`: read
  as numbers; the fake file uses plain number notation and the recorded decimal places.
- A key that holds only `null`: read as an all-missing column, the same as an empty CSV column.
- Dates and times are plain text in JSON: detected as dates on the same rules as CSV text, and written
  back in the same text format.
- Text with escapes, emoji or non-ASCII characters: read as text; invented values use plain
  characters, as for other formats.
- A byte-order mark or Windows line endings: read; line ending and trailing newline are recorded as
  formatting and reproduced.
- An array file with indentation: the indent (compact, 2 spaces, 4 spaces or a tab) is recorded and
  reproduced; any other layout is written compact.
- A file larger than the stated limit: a size warning before profiling, as for CSV and Excel, and a
  stop above the memory the browser can hold.
- A folder of JSON files, GeoJSON, JSON5 and files with comments: not supported; refused with a plain
  message.
- Loading a JSON spec without the file: works for generating, as for the other formats. A CSV, Excel
  or Parquet spec still writes its own format.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to choose a `.json`, `.ndjson` or `.jsonl` file; whether it is an
  array or one record per line MUST be decided by its content, not its name.
- **FR-002**: Reading MUST happen in the browser with no request outside the site (any file the
  reader needs is served by the site itself, as for Excel and Parquet), under the same content policy
  and request counter as the other formats.
- **FR-003**: After loading, the app MUST show only structure: record count, key count, key names in
  first-seen order and the kind of each key (number, text, yes or no, null only, object, list, mixed).
  It MUST NOT show any value.
- **FR-004**: The file MUST be profiled like a CSV: the same column types (categorical, integer,
  decimal, boolean, date and time, ID, personal, free text, short string), cards, review options,
  checks and spec rules apply.
- **FR-005**: The spec MUST record a JSON source: file name, form (array or one record per line), key
  order, the JSON kind of each key, how many records have the key as `null` and how many lack it,
  and the formatting needed to write the file back (indent, line ending, trailing newline, byte-order
  mark).
- **FR-006**: The fake file MUST be in the same form as the real file, with the same keys in the same
  order, each value written as the same JSON kind as the real key (number, text, true or false).
- **FR-007**: `null` and an absent key MUST be kept as different cases: the fake file MUST have the
  same number of `null` values and the same number of records without the key, for each key.
- **FR-008**: A key whose values mix kinds (for example numbers and text) MUST be read as text, MUST
  carry a warning on its card that names the mix, and MUST be written as text.
- **FR-009**: Keys whose values are objects or lists MUST be marked unsupported with a reason that
  names the kind, MUST NOT be flattened, displayed or stored, and MUST be left out of the output unless
  the user keeps them as `null` in every record.
- **FR-010**: The spec MUST NOT hold any value, any text from inside a record, any nested key name or
  any statistic that is a real value. The existing rules for what a spec may hold still apply.
- **FR-011**: The file name MUST default to the original name with a `_fake` suffix and the same
  extension, with the same keep-name option as the other formats.
- **FR-012**: Generated values MUST be identical for the same spec and seed, and changing one key's
  settings MUST NOT change another key's values.
- **FR-013**: A file above a stated size MUST show a warning before profiling with the memory it
  needs; a file above the memory a browser tab can hold MUST be refused with a way forward.
- **FR-014**: A damaged, truncated, empty or non-JSON file, a top level that is not a list of
  records, an item that is not a record, and a record with a repeated key MUST be refused with a plain
  message that quotes no file content.
- **FR-015**: Loading a JSON spec without the file MUST work for generating a JSON file, and a CSV,
  Excel or Parquet spec MUST keep producing its own format.
- **FR-016**: No real value or text from inside a record MUST appear in the page, spec, preview,
  output file, error message, console or browser storage, in any browser the project tests.
- **FR-017**: JSON MUST be available in the offline release with no extra file the user must add, and
  the offline copy MUST read and write it like the hosted site.
- **FR-018**: A spec written by an older version of the app MAY be refused; no support for older spec
  versions is required before version 1.0.0.

### Key Entities

- **JSON source**: The file the user chose: name, form (array or one record per line), record count,
  key list and formatting. Holds structure only.
- **Key description**: Key name, JSON kind, count of `null` records, count of records without the key.
  Never a value.
- **Unsupported reason**: A short fixed text naming why a key cannot be faked (object, list).
- **Fake JSON file**: The generated file: same form, same keys in the same order, fake values, same
  null and missing structure, same layout.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a file with every supported kind of key, the real and fake files have the same keys
  in the same order, and every value has the same JSON kind, when read by two independent readers.
- **SC-002**: No marker value planted in a file's records, nested values or key text beyond key names
  appears anywhere outside the real file, in 100% of automated runs in each tested browser.
- **SC-003**: The network counter shows zero outside requests after a full JSON session, and no file
  other than the app's own is fetched.
- **SC-004**: Generating twice with the same spec and seed gives byte-identical files.
- **SC-005**: For every key, the number of `null` values and the number of records without the key
  in the fake file equal the recorded counts.
- **SC-006**: A JSON file whose data is about 500 MB once opened profiles and exports within the same
  time targets as an equivalent CSV, with the page staying responsive.
- **SC-007**: A saved JSON spec stays under 1 megabyte and holds only structure.
- **SC-008**: Every unsupported or refused case ends in a plain message; none ends in a blank page, a
  crash or a partly written file.
- **SC-009**: An analyst can choose a JSON file and reach the review screen in under 2 minutes without
  reading instructions.

## Assumptions

- The in-browser engine reads JSON through a small reader extension that the site serves itself, the
  way it serves the Excel and Parquet readers; the plan confirms by a spike that it works without a
  network request and decides how kinds and nulls are read. The offline release carries it too.
- The generation step has no access to the database engine (it works from the spec alone), so the
  plan decides how the JSON text is written there; the result must meet the requirements above.
- A `.json` file is an array when its first non-space character is `[`, and one record per line when
  it holds several lines that each start with `{`; anything else is refused. The extension never
  decides.
- Formatting that is not recorded (key spacing, escapes of non-ASCII characters, number notation) is
  written in the common plain way; the fake file is equivalent to the real one, not identical in
  layout.
- Column names and types follow the same rules as CSV once read: JSON's kinds map onto the existing
  column types, and the JSON kind is kept beside them for writing.
- Dates in JSON are text; they follow the existing date detection and are written back as text in the
  recorded format.
- The app is in beta before 1.0.0, so the spec file version may change without a migration.
- Out of scope: nested output, folders of JSON files, JSON Schema import, GeoJSON, JSON5, comments in
  JSON, other locales, coordinates, folder output and multi-table.
