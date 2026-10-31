# Contract: Spec File Version 2 and Generate Worker Sample Request

**Feature**: 002-personal-text-columns. Amends `specs/001-csv-synthetic-slice/contracts/`.

## 1. Spec file

`spec_version` is `2`. Readers accept `1` and `2`. A file with a higher version is refused with the
message "made by a newer version of the app". The authoritative JSON schema stays in
`specs/001-csv-synthetic-slice/contracts/spec-file.schema.json` and gains the three column types
below (updated by task, with `spec_version` allowing 1 or 2).

### personal

```json
{
  "name": "respondent_name",
  "type": "personal",
  "kind": "full_name",
  "quoted": true,
  "na": { "tokens": ["", "NA"], "count": 120, "by_token": { "": 100, "NA": 20 } },
  "repeat_structure": { "1": 48000, "2": 900 },
  "format": { "last_first": false }
}
```

- `kind`: one of `full_name`, `first_name`, `last_name`, `email`, `phone`, `address`, `url`, `ip`, `ssn`.
- `format`: optional; only the keys listed per kind in `data-model.md`.
- `acknowledged: true` is required for `ssn` columns that are generated.
- Additional properties are rejected on this column type, so no list of values can be added.

### free_text

```json
{
  "name": "comments",
  "type": "free_text",
  "mode": "match_shape",
  "min": 3, "max": 412, "mean": 48.2, "sd": 61.0,
  "quantiles": [3, "... 101 values ...", 412],
  "line_breaks": false
}
```

### short_string

```json
{
  "name": "plate",
  "type": "short_string",
  "pattern": ["upper", "upper", { "literal": "-" }, "digit", "digit", "digit", "digit"],
  "length_groups": { "7": 49000, "6": 1000 },
  "repeat_structure": { "1": 50000 }
}
```

## 2. Generate worker: new request

| Message | Payload | Reply |
|---|---|---|
| `sample` | `column: ColumnSpec` (without NA counts), `count: number` (at most 10), `seed: number` | `samples`: `column: string`, `values: string[]` |

The values are invented, so they may be shown. The request holds no real value: it carries the same
column fields as a spec. Errors follow the slice 1 rule: no cell value in any message.

## 3. Profile worker

No new message. `columnProfile` summaries gain the kinds in `data-model.md`. The worker MUST NOT
return any real value for these columns, and its bundle MUST NOT contain the word lists.
