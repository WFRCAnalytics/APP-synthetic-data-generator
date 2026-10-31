// Runs the single-file download test in Chromium, Firefox and WebKit (FR-036). Needs
// `npx playwright install firefox webkit` once. Sets the variable here so it works on every OS.
import { spawnSync } from "node:child_process";

const result = spawnSync("npx", ["playwright", "test", "download-fallback"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, PW_ALL_BROWSERS: "1" },
});
process.exit(result.status ?? 1);
