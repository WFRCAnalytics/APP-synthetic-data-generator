# Contract: spec file version 5

Version 5 adds a JSON source. Everything else is as in version 4. Versions 1 to 4 are no longer read
(the app is in beta before 1.0.0; research R8).

```json
{
  "spec_version": 5,
  "source": {
    "format": "json",
    "file_name": "trips.json",
    "form": "array",
    "indent": "2",
    "line_ending": "lf",
    "trailing_newline": true,
    "bom": false
  },
  "n_rows": 48210,
  "columns": [
    { "name": "id", "type": "survey_id", "json_kind": "string", "json_nulls": 0, "json_missing": 0 },
    { "name": "age", "type": "integer", "json_kind": "number", "json_nulls": 12, "json_missing": 0 },
    { "name": "note", "type": "free_text", "json_kind": "string", "json_nulls": 0, "json_missing": 301 },
    { "name": "tags", "type": "unsupported", "json_kind": "array", "unsupported_reason": "nested_array" }
  ]
}
```

Rules: see data-model.md "Validation". A file that mixes `source.format` values with fields of another
format is refused with a message naming the field, never a value.
