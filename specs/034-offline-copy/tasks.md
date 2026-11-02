# Tasks: The app keeps working without internet

- [x] T001 `src/sw/sw.template.js`, written as `sw.js` with the file list by the `offlineWorker` plugin in `vite.config.ts`
- [x] T002 `src/app/offline.ts`: register, ask for the engine to be fetched, report progress
- [x] T003 Monitor: "Works without internet", cached files counted apart from the page's own data stores; Help text
- [x] T004 `tests/e2e/offline-cache.spec.ts`: a CSV and a workbook with the network off, in four browsers
