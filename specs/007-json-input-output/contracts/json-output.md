# Contract: the written JSON file

**Contains**: an optional byte-order mark (as recorded); for `form: "array"`, `[`, the records, `]`; for
`form: "lines"`, one record per line; the recorded line ending, indent and trailing newline. Each record is
a JSON object whose keys are the recorded names in the recorded order. A key is omitted from exactly
`json_missing` records, is `null` in exactly the other missing-value records (NA count minus `json_missing`), and elsewhere holds a fake value of its
recorded kind: a JSON number, a JSON string, or `true` or `false`.

**Does not contain**: any value, key or text from the real file beyond the key names; nested values (an
unsupported key is omitted, or `null` in every record if the user kept it); comments; trailing commas.

**Determinism**: the same spec and seed give the same bytes. No timestamp or machine detail is written.

**Reading back**: Python's `json` (array form) or `json.loads` per line (lines form) reads it; DuckDB's
`read_json` reads it; keys and order match the spec; counts of null and missing keys match.

**Text**: UTF-8; only `"`, `\`, and control characters are escaped.
