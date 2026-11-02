# Tasks: Start from scratch

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

## Phase 1: Library (pure, no UI)

- [x] T001 `src/lib/design/types.ts`: the design, its column kinds and problems
- [x] T002 `src/lib/design/defaults.ts`: a working default per kind, unique names, kind labels and hints
- [x] T003 `src/lib/design/quantiles.ts`: normal curve, 101 quantiles for even and bell shapes, apportioning counts
- [x] T004 `src/lib/design/validate.ts`: every rule of FR-002 to FR-004 with a message per field
- [x] T005 `src/lib/design/build.ts`: `columnSpecOf`, `specFromDesign` (validated by `validateSpec`)
- [x] T006 `tests/unit/design-build.test.ts`: limits, shares, missing rate, dates, IDs, personal, seed

## Phase 2: Session and state

- [x] T007 `session.loadSpec(spec, designed)` extracted from `loadSpecFile`; `designed` flag and the Review message
- [x] T008 `state.ts`: `designing`, `startDesign`, `designBuilt`; Design stays step 1 until Start over

## Phase 3: Screens (US1, US2)

- [x] T009 `IngestScreen`: the "Start from scratch" entry
- [x] T010 `features/design/DesignScreen.tsx`, `DesignNav.tsx`, `ColumnForm.tsx`, `fields.tsx`, `kindLooks.ts`
- [x] T011 Stepper shows Design with its own icon while a design is open
- [x] T012 `tests/component/design-screen.test.tsx`

## Phase 4: Many columns (US3)

- [x] T013 Duplicate, move up, move down, remove, add several from a list of names
- [x] T014 Search and kind filter in the design list (shown above 6 columns), arrow-key movement, windowed list

## Phase 5: Browser proof

- [x] T015 `tests/e2e/design-flow.spec.ts`: design, review, generate, download, check the file against the limits (SC-002)
- [x] T016 a11y of Design in both themes (FR-012)
- [x] T017 privacy: no request leaves, nothing in storage, clean console (SC-005)
- [x] T018 spec round trip: save a designed spec, load it in a fresh session, same seed gives the same bytes (SC-004)
- [x] T019 Help guide, README and the spec notice mention Start from scratch
- [x] T020 browser matrix (Chromium, Edge, Firefox, WebKit) and offline zip session
- [ ] T021 converge pass
