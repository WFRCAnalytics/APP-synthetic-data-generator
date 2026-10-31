# Contract: Test Fixture Matrix

**Feature**: 001-csv-synthetic-slice

The goal is to test **data types and formats**, not a domain. A deterministic generator
(`scripts/make-fixtures.mjs`, fixed seed, faker for the personal-data columns) writes a "type zoo"
CSV where every column has a known expected result. The generator also writes
`tests/fixtures/zoo/expected.json`, which lists for each column the expected `type`, `status`
(`ok`, `needs_attention`, `unsupported`) and reason codes. Classification tests assert against
that file, so a failure names the exact column and rule.

Public data (see the end) is used only for realism and scale smoke tests, never for assertions.

## 1. Column zoo (expected result per column)

Column names are the stable keys used in `expected.json`.

### Boolean

| Column | Values | Expected |
|---|---|---|
| `bool_tf` | `true`/`false` | boolean |
| `bool_yn` | `Y`/`N`, with 3% NA | boolean |
| `bool_yesno` | `Yes`/`No` | boolean |
| `bool_01` | `0`/`1` | boolean (two values, per SPEC.md) |
| `bool_one_value` | only `true` | categorical (one value) |

### Categorical

| Column | Values | Expected |
|---|---|---|
| `cat_str_5` | 5 labels | categorical |
| `cat_str_50` | exactly 50 distinct short strings | categorical (at the threshold) |
| `cat_str_51` | 51 distinct short strings | unsupported (short string), needs_attention |
| `cat_int_codes` | `1,2,3,5,8,97` | categorical (coded integer), storage integer |
| `cat_int_zero_pad` | `"01"` to `"12"`, quoted | categorical, storage string, leading zeros kept |
| `cat_int_sentinel` | codes plus `-9` | categorical, `-9` flagged as sentinel candidate |
| `cat_rare` | one label appears once | categorical (rare label kept when merging is off) |
| `cat_unicode` | `Café`, `Zürich`, `東京` | categorical |
| `cat_special_chars` | labels with commas, quotes, a newline, leading and trailing spaces | categorical, round-trips with correct quoting |
| `cat_int_50`, `cat_int_51` | integers with 50 and 51 distinct values | categorical, integer (threshold edge) |

### Integer

| Column | Values | Expected |
|---|---|---|
| `int_plain` | 0 to 100000, uniform | integer |
| `int_negative` | -500 to 500 | integer |
| `int_sentinels` | 1 to 600 plus `-9`, `-1`, `998`, `999` | integer, sentinels confirmed, excluded from stats |
| `int_thousands` | `"1,234"` quoted | integer, thousands separator preserved |
| `int_constant` | every value `7` | categorical (one value), needs_attention |
| `int_one_plus_na` | one value, rest NA | categorical, needs_attention |
| `int_skew_zero_inflated` | 60% zeros, long tail | integer, match shape recommended |
| `int_big` | up to 2^53-1 | integer, no precision loss |

### Float

| Column | Values | Expected |
|---|---|---|
| `float_2dp` | `12.34` style | float, decimals 2 |
| `float_6dp` | six decimals | float, decimals 6 |
| `float_trailing_zero` | `1.50`, `2.00` | float, decimals 2 preserved |
| `float_sci` | `1.2e-05` | float, scientific notation flagged needs_attention |
| `float_lognormal` | skewed | float, beta fit flagged or match shape |
| `float_bimodal` | two peaks | float, match shape keeps both peaks |
| `float_negative` | -50.5 to 50.5 | float |
| `float_sd_zero` | every value `3.14` | float, `beta_fit_failed`, falls back to uniform |
| `float_decimal_comma` | `1,5` (in the semicolon file) | float, decimal comma preserved |
| `float_with_sentinel` | `-9.99` flagged | float, sentinel excluded from stats |

### Date, datetime, time

| Column | Example | Expected |
|---|---|---|
| `date_iso` | `2024-03-04` | date, `%Y-%m-%d` |
| `date_us` | `03/04/2024` | date, `%m/%d/%Y` |
| `date_eu` | `04/03/2024` (days above 12 present) | date, `%d/%m/%Y` |
| `date_text_month` | `04-Mar-2024` | date, `%d-%b-%Y` |
| `datetime_iso_t` | `2024-03-04T08:15:00` | datetime |
| `datetime_space` | `2024-03-04 08:15:00` | datetime |
| `datetime_12h` | `03/04/2024 08:15:00 AM` | datetime, `%I` and `%p` |
| `time_hhmm_text` | `"0815"`, with `-9` | time, `%H%M`, sentinel flagged |
| `time_hh_mm` | `08:15` | time, minute granularity |
| `time_hh_mm_ss` | `08:15:42` | time, second granularity |
| `date_ambiguous` | all days at most 12 (`03/04/2024` could be either order) | needs_attention, user picks the pattern |
| `date_mixed_formats` | half `%Y-%m-%d`, half `%m/%d/%Y` | needs_attention, then unsupported if not resolved |
| `date_with_offset` | `2024-03-04T08:15:00-07:00` | unsupported (time zones out of scope) |
| `date_year_only` | `2019` | integer or categorical, not date |
| `date_bad_values` | valid dates plus `00/00/0000` | needs_attention (does not parse every non-NA value) |

### Survey IDs

| Column | Example | Expected |
|---|---|---|
| `id_numeric5` | `10234`, repeats 1 to 5 times | survey_id, mask `[0-9]{5}`, repeat structure kept |
| `id_padded` | `00123` | survey_id, zero padding kept |
| `id_alnum_dash` | `UT-102-884` | survey_id, mask letters, literal `-`, digits |
| `id_prefix_digits` | `HH1048822` | survey_id, constant prefix literal |
| `id_unique_row` | unique per row | survey_id, repeat structure all ones |
| `id_person_seq` | `01`, `02` within a household | survey_id, padded |
| `id_mixed_masks` | two different patterns | needs_attention |
| `id_small_domain` | 3-digit IDs for 5,000 groups (editable) | `id_mask_too_narrow` after edit, Generate blocked |
| `id_few_distinct` | name `hh_id`, only 40 distinct values | survey_id, never categorical (F1 rule) |

### Unsupported in this version (must be excluded, with no real value leaking)

| Column | Example | Expected |
|---|---|---|
| `email` | faker emails | unsupported, possible_identifier |
| `phone_us`, `phone_intl` | `(801) 555-0100`, `+44 20 7946 0958` | unsupported |
| `person_name` | faker names | unsupported |
| `street_address` | faker addresses | unsupported |
| `ssn_like` | `123-45-6789` | unsupported (looks like an ID but matches a personal pattern) |
| `free_text` | 20 to 500 characters, high cardinality | unsupported |
| `short_code_many` | `AB12`, 5,000 distinct | unsupported |
| `url`, `uuid`, `ip_address` | | unsupported |
| `lat`, `lon` | numeric in range, named lat and lon | unsupported (coordinates) |
| `coord_pair` | `(41.7159, -87.6176)` | unsupported |
| `wkt_point` | `POINT (-87.6 41.7)` | unsupported |
| `zip_text` | `"01234"` | categorical or short string; leading zero must survive |
| `currency_text`, `percent_text` | `$1,234.50`, `45%` | unsupported (not plain numbers) |

### Empty, constant and NA handling

| Column | Values | Expected |
|---|---|---|
| `all_na` | every value NA | empty |
| `mostly_na` | 99% NA, a few integers | integer, na count exact |
| `na_blank`, `na_NA`, `na_N_A`, `na_NULL`, `na_dot` | each uses one token | token recorded, reproduced in output |
| `na_mixed_tokens` | blank and `NA` and `.` together | all three recorded, counts per token exact |
| `na_in_every_type` | a few NA in each type above | counts exact |

## 2. File-level variants (same zoo, different containers)

| Variant | What it tests |
|---|---|
| UTF-8 with and without BOM | BOM detected and preserved |
| UTF-16 LE and BE | FR-002 encodings |
| Windows-1252 with accents | encoding detection fallback, round trip |
| Delimiters `,` `;` tab `\|` | delimiter detection |
| No header row | header detection and editing |
| Line endings LF, CRLF, CR | preserved on export |
| Quote style: all fields quoted; minimal; **per-column** (strings quoted, numbers not) | the per-column `quoted` need found in NHTS data |
| Embedded newline and doubled quotes inside fields | writer quoting |
| Ragged rows | clear parse error with no cell value (FR-003) |
| Empty file, header only, 1 row, 0 data rows | boundary handling |
| Duplicate and blank column names | validation messages |
| 1 column, and 500 columns | list and profile scaling |
| A single 1 MB cell | no UI or worker freeze |
| Trailing newline missing | preserved |

## 3. Sizes

| Fixture | Rows | Where | Used by |
|---|---|---|---|
| `zoo_small.csv` | 2,000 | committed in `tests/fixtures/zoo/` | unit and component tests |
| `zoo_100k.csv` | 100,000 | generated on demand, gitignored | integration tests, sampler statistics |
| `zoo_500mb.csv` | about 1,000,000 with the zoo columns repeated with suffixes to about 120 columns | `.fixtures/`, gitignored | scale test (SC-001) |

All three use a fixed seed, so a failing test can be reproduced exactly.

## 4. What the tests assert

- **Detection**: every column's `type`, `status` and reason codes equal `expected.json`.
- **Generation**: for every supported column, exact label counts, NA counts per token, sentinel
  counts, min and max (the check table passes).
- **Format**: the generated file parses with the same code as the source; leading zeros, decimals,
  thousands separators, date patterns, NA tokens and per-column quoting match.
- **Privacy**: no value from `email`, `person_name`, `street_address`, `free_text`, `lat`, `lon`
  or any ID column appears in the spec, the preview, the export or an error message.
- **Determinism**: same seed gives identical bytes; changing one column changes only that column.

## 5. Existing corpora we reuse (no need to invent file-format edge cases)

Others have already built test files for CSV parsing and for type sniffing. We reuse them for the
**file-level** cases and keep our own zoo for the **semantic** types (survey IDs, sentinels,
personal data, unsupported rules), because no public corpus carries expected results for those.

| Source | License | Covers | Use |
|---|---|---|---|
| [`duckdb/duckdb` `data/csv`](https://github.com/duckdb/duckdb/tree/main/data/csv) (215 entries) | MIT | UTF-16, Latin-1, Shift-JIS and invalid UTF-8; mixed, bad and special date and timestamp formats; decimal separators and mixed decimals; leading zeros; quoted newlines; NUL bytes and null padding; header-only, empty, many-column and ragged files | Robustness: every file must profile without a crash, or fail with a clear message holding no cell value. These are written for the same sniffer we run, so they find our wrapper bugs |
| `csv-spectrum` | MIT | Commas and doubled quotes inside fields, LF and CRLF, newlines in quoted fields | Writer and quoting round trip |
| NHTS 2017 `trippub.csv` (546 MB, 115 columns, 923,572 rows, public download) | US federal public data | Coded text with leading zeros, sentinels, repeating IDs, per-column quoting | Realism and scale smoke test |
| Chicago Crimes through the city's API (a 1M-row slice) | City open data terms | ISO datetimes, booleans, block addresses, coordinates and a combined `(lat, lon)` string | Realism smoke test |

`scripts/fetch-corpus.mjs` downloads the selected files, at a pinned tag, into `.fixtures/corpus/`
(gitignored). Nothing from these sources is committed. Tests that need them skip with a clear
message when the folder is absent.

Corpus files have no expected-type ground truth, so tests on them assert only "no crash, no leaked
value, round trip where the file parses", never a specific type.
