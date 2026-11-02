# Tasks: Toolchain upgrade

**Input**: spec.md, plan.md. **Tests**: the golden test first, then the whole suite after every group.

## Phase 1: Safety net

- [ ] T001 Add `tests/unit/golden-output.test.ts`: a fixed spec and seed for each format (CSV, Excel, Parquet, JSON) written through the same code the workers use, with the sha-256 of the bytes pinned in the test; record the hashes from the current tools
- [ ] T002 Record the baseline in `research.md`: test counts, production bundle size (gzip), build time, `npm outdated`

## Phase 2: Groups (each its own commit, suite green at each)

- [ ] T003 [US2] Group A: Vite 8, `@vitejs/plugin-react` 6, Vitest 5, jsdom 30, `@types/node`, `@tanstack/react-virtual`, `lucide-react`; fix `vite.config.ts` and the test config for the new majors; run lint, types, all tests, the built-app browser tests and the offline zip
- [ ] T004 [US2] Group B: ESLint 10 and its plugins; replace `.eslintrc.cjs` by a flat `eslint.config.js` with the same rules; no new warnings of substance
- [ ] T005 [US2] Group C: TypeScript 7; fix any new type errors; check that `tsc --noEmit` and the editors' tooling still work
- [ ] T006 [US2] Group D: React 19, `@types/react` and `@types/react-dom` 19, `@testing-library/*` and `@testing-library/jest-dom` 7 as needed; fix types and any behaviour change; run the a11y suite in both themes

## Phase 3: Polish

- [ ] T007 [P] CI: set the Node version the tools need in `.github/workflows/*.yml` and `engines` in `package.json`
- [ ] T008 Run the browser matrix (Chromium, Edge, Firefox, WebKit) and the offline zip; check SC-001 to SC-005; record results in `research.md`
- [ ] T009 Run `/speckit-converge` and mark the slice complete
