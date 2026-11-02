import { defineConfig } from "@playwright/test";

// Browser tests run against the production build served by `vite preview`, so they see the same
// strict Content-Security-Policy as users do (research.md R9). The "spike" build also contains the
// prototype page used by tests/e2e/spikes.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 15 * 60 * 1000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:4173", acceptDownloads: true },
  webServer: {
    command: "npm run build:spike && npx vite preview --outDir dist-spike --port 4173 --strictPort",
    url: "http://localhost:4173/APP-synthetic-data-generator/",
    reuseExistingServer: true,
    timeout: 5 * 60 * 1000,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    // The installed Microsoft Edge, for the quickstart matrix (`PW_EDGE=1`).
    ...(process.env.PW_EDGE === "1" ? [{ name: "edge", use: { browserName: "chromium" as const, channel: "msedge" } }] : []),
    // Firefox and WebKit run the whole-flow and single-file download tests (`npm run test:e2e:browsers`).
    ...(process.env.PW_ALL_BROWSERS === "1"
      ? [
          { name: "firefox", testMatch: /(flow|excel-flow|excel-quirks|parquet-flow|parquet-privacy|json-privacy|offline-zip|offline-guard|download-fallback|quickstart)\.spec\.ts/, use: { browserName: "firefox" as const } },
          { name: "webkit", testMatch: /(flow|excel-flow|excel-quirks|parquet-flow|parquet-privacy|json-privacy|offline-zip|offline-guard|download-fallback|quickstart)\.spec\.ts/, use: { browserName: "webkit" as const } },
        ]
      : []),
  ],
});
