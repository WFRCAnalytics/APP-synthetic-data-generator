# Data Model: Personal Identifier, Free Text and Short String Columns

**Feature**: 002-personal-text-columns. Extends `specs/001-csv-synthetic-slice/data-model.md`.

## Column types added to the spec file

Column types after this feature: `empty`, `boolean`, `categorical`, `integer`, `float`, `date`,
`datetime`, `time`, `survey_id`, `unsupported` (slice 1) and **`personal`, `free_text`,
`short_string`** (new). All share the slice 1 base fields: `name`, `output_name?`, `exclude?`,
`quoted?`, `na?`, `sentinels?`.

### personal

| Field | Type | Meaning |
|---|---|---|
| `kind` | `full_name`, `first_name`, `last_name`, `email`, `phone`, `address`, `url`, `ip`, `ssn` | What to invent |
| `repeat_structure` | map of group size (string) to number of distinct values | Same meaning as for `survey_id` |
| `format` | object, optional | Format classes kept (see below) |
| `acknowledged` | boolean, `ssn` only | The user accepted generating SSN-style numbers |

`format` fields by kind: `phone`: `shapes` (up to 5 `{shape, share}` where shape uses `9` for a digit
and keeps punctuation, such as `(999) 999-9999`); `full_name`: `last_first` (true when "Last, First"
dominates); `address`: `unit` and `zip4` (booleans); `ssn`: `shape` (such as `999-99-9999`).
A `shape` never holds a letter or digit from a real value.

Validation: `repeat_structure` rows must equal the rows left after NA and sentinels; `ssn` without
`acknowledged: true` is invalid when `exclude` is `include`; no key other than those above is
allowed on the column (this rejects a hand-added `values` list).

### free_text

Same numeric fields as an integer column, in characters: `mode`, `min`, `max`, `mean?`, `sd?`,
`quantiles?` (101 values), `rescale?`, plus `line_breaks` (boolean: values contain line breaks).
`min` is at least 0 and `max` at most 100,000 (longer real values are capped, reason `text_length_capped`).

### short_string

| Field | Type | Meaning |
|---|---|---|
| `pattern` | list of mask tokens (as `survey_id.mask`) | Per-position classes for the longest length |
| `length_groups` | map length (string) to distinct values of that length, at most 64 keys | Length spread |
| `repeat_structure` | as above | Distinct count and repeats |

Validation: `max(length)` equals `pattern` length; each length's group count fits that length's
space (else `id_mask_too_narrow` style error with the shortfall, FR-013 suffix rule applies only
to personal kinds).

## Profile summary (page and worker side)

New `ColumnSummary` kinds: `personal` (`kind`, `repeatStructure`, `distinct`, `format`),
`free_text` (numeric fields plus `lineBreaks`) and `short_string` (`pattern`, `lengthGroups`,
`repeatStructure`, `distinct`). New reason codes: `kind_mixed`, `suffix_needed`,
`ssn_needs_acknowledgement`, `text_length_capped`, `needs_source_file`. `LocalEdits` gains `personalKind`, `ssnAcknowledged`,
`shortPattern`. None of these holds a value.

## Generation entities (pure TypeScript, no state)

- **Composer**: `(kind, options) -> (index: bigint) => string`, with `space: bigint`.
- **Text generator**: `(spec, seed) -> valueAt(row)` using the shared placer for NA and sentinels.
- **Word lists**: one module, imported by the generate worker only.

## Transitions

`unsupported` (slice 1 spec or detection) to a kind: by the user's choice on Review, or by
detection; `ssn` stays `unsupported` until `acknowledged` is set.
