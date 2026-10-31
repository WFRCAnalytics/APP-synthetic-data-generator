# Research: Personal Identifier, Free Text and Short String Columns

**Feature**: 002-personal-text-columns

No NEEDS CLARIFICATION items remained after the spec. The decisions below settle how to build it.

## R1: Where invented values come from

- **Decision**: Use the en_US word lists inside `@faker-js/faker` (first names, last names, street
  suffixes, city names, states, free email domains, and so on) as data, and compose values from
  them myself by index. Do not call the faker value generators per value.
- **Rationale**: The spec needs an exact distinct count and an exact repeat structure. A generator
  that draws random values cannot promise that two groups never collide, and fixing collisions
  needs memory of past values. Composing a value as a pure function of an index (first name
  index, last name index, suffix) through a keyed bijection is unique by construction, needs no
  memory, and costs only array lookups, which matters at millions of rows. It still satisfies the
  constitution: values come from faker's en_US data, never from the real file.
- **Alternatives**: calling `faker.person.fullName()` per row with a seeded instance (collisions,
  slow, needs a dedupe set that grows with the column); an own word list (duplicates faker and
  loses its coverage); real-value shuffling (forbidden).

## R2: Keeping the exact distinct count and repeat structure

- **Decision**: Reuse the survey ID approach (`src/lib/generate/survey-id.ts`): a row's rank among
  the column's real values picks its group through the repeat structure, and a keyed bijection maps
  group to a position in the space of possible invented values. The position is turned into a value
  by the kind's composer. When the natural space is smaller than the groups needed, a numeric
  suffix extends the space (names get a middle initial and then a number; emails a number) and the
  Review card shows a note.
- **Rationale**: One proven mechanism for IDs, names, emails and short strings; chunk-size
  independent; unique by construction.
- **Alternatives**: random draws with retry (stateful); hashing to a value (collisions).

## R3: Natural space of each kind, and the suffix rule

- **Decision**: Space sizes from en_US data (rounded): full name about 3,000 first x 1,000 last x 26
  initials = 78 million; first name alone about 3,000 (suffix beyond); last name about 1,000
  (suffix beyond); email: name part x 25 domains x numeric tail; phone: area codes valid in NANP
  x exchange x line = about 6 billion; street address: number x street name x suffix x city/state/zip
  groups; URL: host words x TLD x path; IPv4: 2^32 minus reserved ranges; IPv6 not generated. Beyond
  the natural space, a decimal suffix is appended (`Smith 2`) and the card says so (FR-013).
- **Rationale**: Covers every realistic survey (millions of rows) without a suffix for full names.
- **Alternatives**: refusing to generate beyond the space (breaks FR-013).

## R4: Format classes kept from the real column

- **Decision**: Profile the commonest character-class shapes (digits as 9, letters as A, other
  characters kept), up to 5 shapes with shares, for phone, SSN-style and short strings. A shape holds
  punctuation and lengths, never a value. Email keeps nothing from the real value except that it has
  the form of an email (the domain is never copied, FR-005). Names keep only the kind (full, first,
  last) and, for full names, whether a comma form "Last, First" dominates. Address keeps the
  presence of a unit and ZIP+4 as two booleans.
- **Rationale**: Format fidelity (Principle IV) without storing values; shapes of digits and
  letters cannot identify a person.
- **Alternatives**: copying domains (leaks the organisation of respondents).

## R5: Detection

- **Decision**: Extend `classifyColumn` in this order: personal identifiers (email, phone, SSN-style
  by value shape over the shape sample; names, addresses, URLs, IPs by value shape and column name),
  survey ID (unchanged), categorical (unchanged), numeric (unchanged), free text (mean length at
  least 40 or many values with spaces and names like comment, note, remark, description), short
  string (the rest of the string columns with distinct count above the categorical limit).
  Anything classified as personal, free text or short string keeps `status` ok or `needs_attention`
  instead of `unsupported`. Mixed columns (shape share under 80% for the winning kind) get the
  reason `kind_mixed`.
- **Rationale**: Slice 1 order already covers personal data first; this only replaces
  `unsupported` with a kind. The shape sample is already collected, so no new value is read.
- **Alternatives**: a dictionary lookup of real names (forbidden: would hold names).

## R6: Frequent-value fetching

- **Decision**: For string-like columns (fewer than half of the values parse as numbers) whose
  distinct count exceeds the categorical limit, `collectBasic` does not fetch the most frequent
  values. Numeric columns keep fetching them, because slice 1 sentinel detection depends on them
  (a float column with -9 codes), and a regression test pins that. Sentinels in such columns are found by matching a fixed
  built-in vocabulary (refused, unknown, n/a, none, dk, 99, 999 and similar) in SQL, returning only
  counts per vocabulary word.
- **Rationale**: Frequent values of a name column are real names. They never leave the profile
  worker today, but FR-008 asks that none is read at all for these columns, and the spy test
  proves it. Low-cardinality columns still need real labels (categorical).
- **Alternatives**: keep fetching and discard (weaker guarantee, harder to test).

## R7: Free text

- **Decision**: Store length statistics in characters (min, max, mean, sd, 101 quantiles), the same
  fields as an integer column, and generate length with the existing numeric generator (exact min
  and max, mode uniform, match_mean_sd or match_shape). Text is lorem-style words from the
  generator's own small word list (not the real text), cut at the chosen length, with sentence
  punctuation; embedded line breaks occur only if the real column had them (a boolean), and then
  rarely and deterministically.
- **Rationale**: Reuses tested code; exact min and max for free.
- **Alternatives**: word-count based lengths (less exact for truncation code).

## R7a: Short strings

- **Decision (shortfall rule)**: unlike personal kinds, a short string pattern that is too narrow
  blocks generating with the ID-style shortfall message (FR-013); no suffix is added.
- **Decision**: Store a per-position pattern for the longest length (same tokens as ID masks:
  digit, upper, lower, letter, alnum, literal), `length_groups` (distinct values per length, at most
  64 lengths), and the repeat structure. A value of length L uses the first L positions of the
  pattern; the groups of each length are filled through the bijection of that length's space.
  Distinct count is exact; lengths follow the real spread of distinct values.
- **Rationale**: Reuses the ID mask code (`src/lib/mask/mask.ts`); the real values never appear.
- **Alternatives**: shuffle of real values (forbidden).

## R7b: Switching a slice 1 unsupported column to a kind

- **Decision**: The Type selector on Review gains the new types, and choosing one re-profiles the
  column through the profile worker (forced type). It needs the source file. With only a spec
  loaded, the selector for such a column is disabled and the card explains that the file is
  needed (FR-017). Spec-only mode otherwise keeps working for columns that already hold a kind.
- **Rationale**: A version 1 spec keeps no figures for unsupported columns, and inventing
  defaults would produce a table that does not match the real one.
- **Alternatives**: default shapes with a unique-per-row assumption (silently wrong).

## R8: SSN-style columns

- **Decision**: Kind `ssn`, generated only when the column has `acknowledged: true`. Invented values use
  area numbers 900 to 999, which are never assigned. Unacknowledged columns stay `unsupported`
  and left out, with a card that explains and offers the checkbox.
- **Rationale**: Clarification Q1 (option C) and a safe range.
- **Alternatives**: area 000 (smaller space); never generating (rejected by Q1).

## R9: Spec version

- **Decision**: `SPEC_VERSION` becomes 2 and the validator accepts 1 and 2. Files the app writes carry
  2. A version 1 file loads unchanged; a file with a newer version still gets the existing clear
  message. The JSON schema in `contracts/` is versioned the same way.
- **Rationale**: FR-017 and the slice 1 version message; older apps reject version 2 files with a
  clear message instead of misreading new types.
- **Alternatives**: staying at 1 (older apps would fail on unknown types with a vague message).

## R10: Live samples on the Review card

- **Decision**: The Review screen asks the generate worker for samples: a new `sample` request
  with the kind, shape options and a count, answered with invented values. The main bundle and the
  profile worker hold no word lists.
- **Rationale**: FR-015 (faker only where generation happens); samples are invented, so showing
  them is safe.
- **Alternatives**: bundling the lists into the main bundle (adds size for everyone, breaks the
  rule).

## R11: Bundle size

- **Decision**: Import the en_US locale data only, from the faker package entry points that keep
  tree shaking working, and measure the generate worker before and after. Record the number in this
  file after implementation. Budget: generate worker grows by less than 1.5 MB minified.
- **Rationale**: The page loads the generate worker only when generating (and for samples), so the
  cost is paid late and only once.
- **Alternatives**: a trimmed copy of the lists (maintenance); lazy loading by kind (later if the
  budget is missed).

## R12: Privacy tests

- **Decision**: Add a spy test beside `id-inference.test.ts` that records every row the data engine
  returns while profiling the new columns and fails if any real value appears; extend
  `spec-privacy.test.ts` and `tests/e2e/privacy.spec.ts` with the new fixture columns; add a
  bundle test that fails if the profile worker or the main bundle contains faker word-list markers.
- **Rationale**: FR-008, FR-014, FR-015, SC-002.
- **Alternatives**: review by eye (not repeatable).

## R13: Free text length cap

- **Decision**: Lengths are capped at 100,000 characters. A real value longer than that is
  counted at 100,000 and the card shows the reason `text_length_capped`.
- **Rationale**: keeps the spec valid and generation memory bounded.

## Open items

None.
