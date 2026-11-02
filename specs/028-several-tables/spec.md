# Feature Specification: Several tables at once

**Status**: Complete

On the first screen, "Make several tables at once" takes the saved specs of several tables (households and persons whose ID columns are
linked, say), shows the set, warns when a link or a count has no table in the set to fit, makes every table, and offers all the files in
one zip, each table in a folder with its fake file, spec and README for agents.

- **FR-001**: Each table is made from its own spec and seed in the generating worker, one after another, exactly as it is made on its own screen: the bytes are the same (`tests/e2e/id-link.spec.ts`).
- **FR-002**: A spec that is not valid is set aside with a plain reason and never quoted; at most 24 tables a set.
- **FR-003**: A linked ID column whose table is not in the set (or has another seed), and a count whose other table is missing, are named as warnings; the tables are still made.
- **FR-004**: A table that fails does not stop the others; the table of results says which checks passed, and "Stop" ends the run.
- **FR-005**: Nothing is read from a real file and nothing leaves the device.

## Assumptions

- Out of scope: conversion to SPSS, Stata or SAS transport inside a set (a spec's own type is written), editing a table inside the set, and running a set from a folder.
