# Implementation Plan: README for agents

**Spec**: [spec.md](spec.md)

## Summary

`agentReadme(spec, options)` in `src/lib/readme/agentReadme.ts` is a pure function from a spec to Markdown (file facts, a column table,
usage notes), with `readmeFileNameFor`. `Session.readmeBlob()` builds it from the current spec, the fake file name, the spec file name,
the seed and the app version; the Generate screen gets a "Download README for agents" button beside the spec download. No dependency.

## Constitution Check

Privacy and minimal artifact: the page holds only what the spec holds. Reproducibility: same spec and seed, same text. Tests first:
unit tests for the function, one end-to-end read of the download.
