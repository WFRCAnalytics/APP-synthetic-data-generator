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
    // Firefox and WebKit only run the single-file download test (`npm run test:e2e:browsers`).
    ...(process.env.PW_ALL_BROWSERS === "1"
      ? [
          { name: "firefox", testMatch: /download-fallback\.spec\.ts/, use: { browserName: "firefox" as const } },
          { name: "webkit", testMatch: /download-fallback\.spec\.ts/, use: { browserName: "webkit" as const } },
        ]
      : []),
  ],
});
