# Implementation Plan: Codebook import

**Spec**: [spec.md](spec.md)

## Summary

`src/lib/codebook/codebook.ts` parses a codebook (CSV or JSON, with common header names and delimiters) into entries and matches them
to a table's profiles (`matchCodebook`). Labels live on the column as `valueLabels`, a local edit (so they survive a re-profile and
work for a saved spec with no file), and are written to the spec as `value_labels`, checked against the values the column holds.
Review's overview gets a `CodebookPanel`, the card lists the labels with a remove button, the summary lines and the README use them.

## Constitution Check

Privacy: read in the page only, labels are documentation limited to values the spec already holds. Minimal artifact: short labels,
capped, tied to known values. Format fidelity and reproducibility: the file is unchanged. Tests first: parse, match, spec and README
tests, one end-to-end.
