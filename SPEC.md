# Synthetic Data Generator for AI Coding Agents — Design Document (v1)

Oct 30, 2026 · @Pukar Bhandari

## Overview

The tool turns one private table into a fake table with the same columns, row count, types, formats and summary statistics, so AI coding agents can build analysis code without ever seeing real data. It runs entirely in the browser; no data leaves the device.

The target data is household travel surveys, transit onboard surveys and similar tabular survey data. These contain respondent locations, demographics and identifiers that must not be exposed to an agent.

The intended workflow:

1. Generate a fake copy of each table and place it in a mirror project folder.
2. Let the AI agent write, run and debug analysis code against the fake data.
3. Swap the fake files for the real files (same names, same formats) and rerun the code locally.

Because final results always come from real data, the fake data only needs to be good enough for code to run and for outputs to look plausible. It does not need to reproduce real findings.

## Goals and non-goals (v1)

Version 1 handles one table at a time, from CSV, Excel or Parquet, with every column generated independently of the others.

**Goals**

- Preserve the table's shape: column names, column order and row count.
- Preserve each column's type and on-disk format, so parsing code written on fake data works on real data unchanged.
- Preserve per-column summaries: category counts, NA counts, sentinel-code counts, and exact min and max for numeric, date and time columns.
- Make mean/sd or distribution shape matching optional per column.
- Break all row-level linkage: no fake row corresponds to a real respondent.
- Never output real values for personal identifiers, free text or coordinates.
- Let the user review and override every decision before generation.
- Produce reproducible output from a user-set seed.
- Run with no installation and no network calls after the page loads.

**Non-goals for v1**

- Relationships across tables, such as the household → person → trip hierarchy.
- Correlations between columns within a table.
- Row-level rules such as arrival time after departure time.
- Formal privacy guarantees such as differential privacy.
- SPSS (.sav), Stata (.dta), JSON or other file formats.
- Processing a whole folder in one pass.

## Privacy model

Privacy comes from breaking row linkage: each column is generated independently, so no fake row describes a real person, even when individual values come from the real data.

The table below lists what leaves the real data, and in what form.

| Column kind | What the fake data keeps | Real values in output? |
| --- | --- | --- |
| Categorical (including coded integers) | Exact label set and count per label | Yes, labels only, in shuffled rows |
| Numeric, date, time | Exact min and max; optionally mean/sd or quantile shape | Only min and max, in random rows |
| Survey-assigned ID (shuffle mode) | Exact set of ID values and how often each repeats | Yes, in shuffled rows |
| Personal identifier (fake mode): name, email, phone, address | Format and uniqueness | No |
| Free text | Length distribution | No |
| Latitude/longitude | Bounding box and precision | No |
| NA and sentinel codes | Exact counts | Codes only, in shuffled rows |

The user chooses the ID mode per column in the review step. Shuffle mode is for IDs that mean nothing outside the dataset (household 10234, person 1023402); it keeps joins between separately generated tables working. Fake mode is required for real-world identifiers, because a shuffled list of real emails or phone numbers is still a leak. The profiler proposes a mode, and the user confirms it; columns can also simply be excluded.

Optional protections, off by default:

- Merge categories with fewer than k rows into "Other" (k set by the user).
- Replace category labels with neutral codes ("cat\_01", "cat\_02").
- Rename columns.

Label replacement is off by default because survey analysis code filters on exact labels, and replacing them would mean rewriting that code before switching to real data.

## Architecture

The app is a static web page: parsing, profiling and generation all run in the browser tab through WebAssembly, and the page makes no network calls after it loads.

&#91;embedded content: architecture · 6 components in 2 zones\]

Only the top zone ever holds real data. The generator and writer work from the spec alone, which is why a saved spec can be reused later without the real file.

| Component | Library or API | Role |
| --- | --- | --- |
| File reading and writing | DuckDB-WASM | Read CSV, Parquet and Excel; write CSV and Parquet; run profiling queries in SQL |
| Excel fallback | SheetJS | Read or write XLSX if DuckDB-WASM's Excel support falls short (to be tested) |
| Fake identifiers | @faker-js/faker | Names, emails, phone numbers and addresses, by locale |
| Random numbers | A small seeded generator such as sfc32 | Reproducible draws with per-column sub-seeds |
| Numeric sampling | Hand-written | Beta sampler (via gamma draws) and percentile interpolation |
| Folder output | File System Access API | Save into a chosen folder in Chromium browsers; plain download elsewhere |

The app ships as a folder of static files: the page plus the DuckDB-WASM binaries, which run to tens of MB. Bundling those binaries, instead of loading them from a CDN, keeps the "no network calls" promise checkable in the browser's network tab. Some browsers block WebAssembly workers on pages opened straight from disk, so serving the folder from an internal static host or a one-line local server is the safer default.

## Workflow

The user works through three stages and confirms each one before moving on. Real data is read only in stages 1 and 2; stage 3 reads only the spec.

1. **Ingest.** The user picks a file. For Excel, they pick a sheet and the header row; for CSV, the app detects delimiter, encoding, quoting and header, and shows them for confirmation. The app loads the table into DuckDB in memory and shows the row count, column count and a list of column names. The real rows are never displayed.
2. **Profile and review.** The app detects each column's type and computes its summary. The user sees one card per column and can:
   - Override the detected type.
   - Confirm or edit sentinel codes.
   - Choose the numeric mode, rounding and ID mode.
   - Pair latitude and longitude columns, or mark a combined coordinate column.
   - Exclude a column, so it is dropped from the output.
   - Turn on the optional protections.

   When done, the user saves the spec as a JSON file. A saved spec can be loaded later to skip this stage.
3. **Generate.** The user sets a seed and the app generates the fake table from the spec alone. A preview shows the first 50 fake rows next to the spec's summaries, plus a check that every summary was met. The user then exports the file.

Closing or reloading the page clears all real data from memory.

## Type detection

The profiler assigns each column one of the types below, using the first matching rule in table order; the user can override any of them.

| Type | Detection rule (default) | Example in travel surveys |
| --- | --- | --- |
| Empty | Every value is NA | Unused question |
| Boolean | Only two values, from pairs such as true/false, yes/no, Y/N, 0/1 | Has driver's license |
| Coordinate pair (combined) | Strings matching "lat, lon", "(lat, lon)" or WKT POINT | Origin point |
| Latitude / longitude | Numeric in \[-90, 90\] or \[-180, 180\] and the column name contains lat, lon, lng or long, or x/y | o\_lat, d\_lon |
| Date / datetime / time | Parses as a date, datetime or time-of-day in one consistent format | Travel date, depart time |
| Personal identifier | Matches email, phone or person-name patterns, or the name contains name, email, phone, address | Contact email |
| Survey ID | Integer or code string, unique or repeating in groups, name ends in id or \_num | hh\_id, person\_id |
| Categorical | 50 or fewer distinct values (threshold configurable), integer or string | Mode codes 1, 2, 3, 5, 8, 97 |
| Integer | Whole numbers above the categorical threshold | Trip duration in minutes |
| Float | Decimal numbers | Trip distance, survey weight |
| Free text | Strings with high cardinality and a mean length over 20 characters | "Other, specify" responses |
| Short string | Any remaining string column | Route name |

Rules that matter most for survey data:

- **Coded integers default to categorical.** Mode, purpose and income bracket are stored as integer codes. Generating values between min and max would create codes that don't exist in the codebook.
- **Sentinel codes are detected separately.** Values such as -9, -1, 995, 998 and 999 usually mean "don't know", "refused" or "not applicable". The profiler flags candidates (negative values in an otherwise positive column, isolated 9-pattern values at the top of the range) and the user confirms them. Confirmed sentinels are kept with exact counts and excluded from min, max, mean and sd.
- **NA tokens are recorded per column.** The profiler records which tokens represent missing values (blank, "NA", "N/A", "NULL", "."), so the output uses the same ones.

## Generation rules

Every column starts the same way: its NA and sentinel rows are placed at random positions with their exact counts, and only the remaining rows are generated by the rules for its type.

| Type | How values are generated | User options |
| --- | --- | --- |
| Categorical, boolean | The exact multiset of labels (count per label) shuffled into random rows | Merge rare categories; replace labels with codes |
| Integer, float | One of three numeric modes (below), always hitting the exact min and max | Mode; decimals or integer |
| Date, datetime, time | Converted to a number (days, seconds since epoch, seconds since midnight), generated with a numeric mode, converted back | Mode; granularity (day, minute, second) |
| Latitude, longitude (separate) | Each column independently, uniform within its own min and max by default | Mode; decimal places |
| Coordinate pair (combined) | Lat and lon generated as above, written back in the column's original format and axis order | Decimal places |
| Survey ID | Shuffle: the exact multiset of real IDs in random rows. Fake: new IDs with the same pattern and the same repeat structure | Shuffle or fake |
| Personal identifier | Fake values from faker.js (names, emails, phones, addresses), with the same repeat structure | Locale; exclude column |
| Free text | Lorem ipsum with character lengths drawn from the real length distribution | None |
| Short string | Fake strings that keep each character's class (letter, digit, separator) and the length distribution | Shuffle real values instead |
| Empty | All NA, using the original NA token | None |

**Numeric modes.** All three modes place the real min and max in two random rows, then generate the rest between them.

- **Uniform** (default for coordinates): values spread evenly between min and max.
- **Match mean and sd** (default for other numerics): a beta distribution scaled to \[min, max\], fitted to the real mean and sd. This is the only common distribution that respects fixed bounds and hits a target mean and sd at the same time. The median comes out approximately right.
- **Match shape**: the spec stores percentiles (101 by default, so 1% steps), and values are drawn by interpolating between them. This keeps skew, peaks and the median, for example the AM and PM peaks in departure times.

The beta fit, with values first rescaled to the 0–1 range:

```latex
m = \frac{\bar{x} - \min}{\max - \min}, \quad v = \frac{s^2}{(\max - \min)^2}, \quad \alpha = m\left(\frac{m(1-m)}{v} - 1\right), \quad \beta = (1-m)\left(\frac{m(1-m)}{v} - 1\right)
```

Rounding to integers or fixed decimals moves the mean and sd slightly. An optional final step rescales the generated values to restore the exact mean and sd, then re-clips to the bounds.

**Repeat structure for IDs.** The spec stores how many distinct values appear once, twice, three times and so on, never the values themselves. Fake IDs are generated to match that structure, so a column where each household ID appears 2.4 times on average keeps that property.

**Seeding.** A seeded random generator is used throughout. Each column gets its own sub-seed derived from the global seed and the column name, so changing one column's settings does not change any other column's output.

## Format preservation and export

The exported file is written in the same format and layout as the input, because agents mostly break on parsing details rather than on statistics. The swap to real data only works if the fake file looks identical to a parser.

| Level | What is preserved |
| --- | --- |
| File | Format (CSV, XLSX, Parquet), file name with a "\_fake" suffix (or the original name, user's choice) |
| CSV | Delimiter, quote character and quoting style, encoding, line endings, header presence, BOM |
| Excel | Sheet name, header row position, rows above the header (replaced with blank rows), cell types |
| Parquet | Column dtypes, including nullable integers, timestamps with time zone, and dictionary-encoded strings |
| Column | Name, order, NA token, sentinel codes, decimal places, leading zeros, thousands separators |
| Date and time | Exact string format (for example "03/04/2024" or "2024-03-04T08:15:00"), time zone, granularity |
| Coordinates | Decimal places (user-set), axis order and string format for combined columns |

Excel output is limited to one sheet per export in v1. Formulas, merged cells and styling are not reproduced; the export contains values only.

## Spec file

The spec is a JSON file that holds everything generation needs, and nothing more. It is the only artifact derived from real data, so the user can read it end to end and know exactly what was taken.

A trimmed example:

```json
{
  "spec_version": 1,
  "source": {"format": "csv", "file_name": "trips.csv", "delimiter": ",", "encoding": "utf-8", "quote": "\"", "header": true},
  "n_rows": 48213,
  "seed": 42,
  "columns": [
    {"name": "hh_id", "type": "survey_id", "mode": "shuffle", "values_ref": "hh_id.values"},
    {"name": "mode", "type": "categorical", "storage": "integer",
     "counts": {"1": 20811, "2": 9450, "3": 7120, "5": 5302, "8": 4997, "97": 391}, "na": {"token": "", "count": 142}},
    {"name": "trip_dist_mi", "type": "float", "mode": "match_mean_sd", "decimals": 2,
     "min": 0.05, "max": 87.4, "mean": 6.83, "sd": 8.91, "sentinels": {"-9": 210, "998": 33}},
    {"name": "depart_time", "type": "time", "format": "%H:%M", "mode": "match_shape", "quantiles": ["00:05", "04:40", "..."]},
    {"name": ["o_lat", "o_lon"], "type": "lat_lon", "mode": "uniform", "decimals": 4,
     "bbox": {"lat": [39.2496, 40.1563], "lon": [-75.6, -74.7]}},
    {"name": "email", "type": "personal_id", "mode": "fake", "kind": "email", "repeat_structure": {"1": 9120}},
    {"name": "other_purpose_text", "type": "free_text", "length_quantiles": [3, 11, 24, 61, 240]}
  ]
}
```

Design rules for the spec:

- Real values appear only where the privacy model allows: category labels, min and max, sentinel codes, and shuffled survey IDs.
- Shuffled survey ID values are large, so they are stored in a separate values file next to the spec rather than inline. Keep it to regenerate later; without it, those columns fall back to fake mode.
- Every field is editable by hand. The app validates an edited spec on load and reports problems by column.
- The spec carries a version number so later versions of the app can read older specs.

## UI outline

The app is a single page with a three-step stepper (Ingest, Review, Generate); the user can go back to any earlier step, and later steps are recomputed.

| Screen | Main elements | User actions |
| --- | --- | --- |
| Ingest | File drop zone, "Load existing spec" button, detected CSV settings or Excel sheet picker, table size | Confirm parse settings, continue |
| Review | One card per column: name, detected type, summary (counts, min/max, mean/sd, NA, sentinels), a small histogram or bar chart drawn from the summary | Override type, set mode and rounding, confirm sentinels, pair lat/lon, exclude, save spec |
| Generate | Seed field, Generate button, preview of 50 fake rows, a check table comparing target vs achieved summaries per column | Regenerate with new seed, export file, export spec |

The Review screen also has a column list with filters ("needs attention", by type) and a banner flagging columns the profiler was unsure about: possible identifiers, possible sentinels, and integer columns near the categorical threshold.

A persistent notice states that data is processed locally and that reloading the page clears it.

## Known limitations

The main tradeoff of independent columns is that code runs on fake data but some intermediate results look odd; these oddities disappear when real data is swapped in.

- **No cross-column logic.** Arrival can precede departure, a child can hold a driver's license, and a walk trip can be 80 miles long. Filters on combined conditions return plausible row counts, but not realistic ones.
- **Joins across tables are approximate.** Shuffled IDs keep join keys valid, but the number of persons per household in one table won't match the household size column in another.
- **Spatial joins return some NAs.** Coordinates are uniform within a rectangle, so some points fall in water or outside every zone, and origin–destination distances run longer than real trips.
- **Mean and sd can be off slightly after rounding.** The optional rescale step restores them, at the cost of a few values moving.
- **Labels are real.** Category labels, sentinel codes and min/max values come from the real data. Rare categories are visible unless the user turns on merging.
- **Browser memory caps table size.** WebAssembly memory limits make tables above roughly 1–2 GB impractical; travel survey tables are usually far smaller.
- **Some browser features vary.** Folder-level file access works in Chromium-based browsers; others fall back to single-file download.

The user and the agent should both know these limits, so the agent doesn't "fix" code that is correct. A short note describing them can be included with the exported file.

## Future work and open questions

The highest-value next step after v1 is multi-table hierarchy, because household → person → day → trip joins are central to travel survey analysis.

**Candidate features after v1**

- Multi-table hierarchy: declared parent–child keys, parents generated first, children per parent following the real distribution.
- Row-level rules: column A ≥ column B, sequential numbering within a group, derived columns (total = quantity × price).
- Zone-based coordinates: points generated inside user-supplied zone polygons (GeoJSON) instead of a rectangle.
- Folder mode: process every supported file in a folder and write a mirror folder in one pass.
- Codebook import: read value labels from a codebook to set categorical levels and sentinel codes automatically.
- SPSS and Stata support, which survey data often arrives in.
- An auto-generated README for the agent describing the fake data and its known oddities.

**Open questions**

- [ ] Should excluded columns be dropped, or kept as all-NA so the column list still matches the real file?
- [ ] Is 50 the right default threshold for integer-to-categorical detection on your surveys?
- [ ] Should exported files keep the original name (best for swapping) or get a "\_fake" suffix (safer against mix-ups)?
- [ ] Is the DuckDB-WASM Excel reader sufficient, or is SheetJS needed as a fallback? To be tested in the prototype.
- [ ] Where will the app be hosted: a local HTML file, an internal server, or a static site?
