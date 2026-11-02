# Implementation Plan: Coordinates

**Spec**: [spec.md](spec.md)

## Summary

`src/lib/classify/coordinate.ts` guesses an axis from a column's name and range. The classifier no longer leaves latitude and longitude
columns out; the profiler marks a decimal column as a coordinate (`coordinate` on the profile). The spec builder writes such a column as
uniform with its box and decimals only; the validator enforces that; the loader reads it back. Review's numeric controls get a Coordinate
select (and hide the mode and rescale controls for a coordinate), the summary lines and the README say "only the bounding box is kept".

## Constitution Check

Principle II (coordinates limited to a bounding box and precision) is the point of this slice and is enforced by the validator.
Privacy, format fidelity and reproducibility are untouched. Tests first: guessing, building, validating and generating are unit tested.
