# Implementation Plan: Start from scratch

**Spec**: [spec.md](./spec.md) · **Slice**: 6 · **Depends on**: slices 1 to 5 (spec file, Review, Generate)

## Approach

A design is a list of column definitions in plain terms. One pure function turns each definition into a `ColumnSpec` (the type the spec file already holds); a second wraps them in a `SpecFile` with a CSV source and validates it with the existing `validateSpec`. The session then takes that spec exactly as it takes a saved one (`loadSpec`), so Review, Generate, the check table and the downloads need no change in how they work. The generator never learns that a table was designed.

```
Design screen (definitions, in memory)
   └─ specFromDesign(defs, rows, seed, name)  ->  SpecFile (validated)
         └─ session.loadSpec(spec, { designed: true })  ->  Review -> Generate
```

## Decisions

1. **No new spec version.** The designed table writes a CSV source (UTF-8, comma, header). A saved spec of a designed table is indistinguishable from any other and loads anywhere.
2. **Bell-shaped numbers** become 101 quantiles from a normal distribution truncated to [min, max] (inverse error function, no dependency), with `mode: "match_shape"`; even numbers use linear quantiles (the loader's default) with `mode: "uniform"` if the spec offers it, else match_shape over linear quantiles.
3. **Categories** carry integer counts that sum to the row count (largest remainder), so shares are exact at design size and the existing check table passes.
4. **Dates** use the numeric encoding of `datefmt` (`toNumber`), format `%Y-%m-%d` (or `%Y-%m-%d %H:%M:%S` for date and time), granularity day or second.
5. **IDs** become a `survey_id` column: mask = literal prefix plus N digits, padded, `repeat_structure {"1": rows}` (each ID once) with min 1 and max 10^N - 1 checked against the row count (the existing `idFit`).
6. **Personal** columns use `repeat_structure {"1": rows}` and the kind chosen.
7. **Missing rate** becomes `na: { tokens: [""], count: round(rows * rate) }`.
8. **Design state** lives in `App` (React state), not the session, so it survives Review and Generate and is cleared by Start over. It is never written to storage.
9. **Review of a designed table** reuses `specOnly` (no source file) with `designed: true` so the banner says "designed in this app" and the settings that need data stay off, with a pointer back to Design.
10. **Rail**: step 1 reads "Design" with a pencil icon while a design is open; otherwise "Ingest".

## Touch points

| Area | Files |
|------|-------|
| Pure library | `src/lib/design/types.ts`, `defaults.ts`, `validate.ts`, `quantiles.ts`, `build.ts` |
| Session | `src/app/session.ts` (`loadSpec(spec, opts)` extracted from `loadSpecFile`; `designed` flag) |
| State | `src/app/state.ts` (`designing`, actions `startDesign`, `designBuilt`) |
| UI | `src/features/design/DesignScreen.tsx`, `ColumnForm.tsx`, one editor per kind, `DesignList.tsx` (shares the sidebar list pattern of Review) |
| Ingest | three entry cards on `IngestScreen.tsx` |
| Shell | `Stepper.tsx` label and icon, `App.tsx` routing |
| Tests | unit (`design-build`, `design-quantiles`, `design-validate`), integration (generate from a design, byte-identical after save and load), component (`design-screen`), e2e (`design-flow`, a11y, privacy) |

## Constitution check

- Principle I (data never leaves the device): a design holds no real data; nothing is stored or sent.
- Principle VII (brand tokens): new screens use the existing tokens and components.
- Accessibility: every control labelled, keyboard operable, errors announced next to the field.
