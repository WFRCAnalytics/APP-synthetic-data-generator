// Runs the whole-flow and single-file download tests in Chromium, Firefox and WebKit (FR-036). Needs
// `npx playwright install firefox webkit` once. Sets the variable here so it works on every OS.
import { spawnSync } from "node:child_process";

const result = spawnSync("npx", ["playwright", "test", "flow.spec", "excel-flow.spec", "excel-quirks.spec", "offline-zip.spec", "offline-guard.spec", "download-fallback", "quickstart.spec"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, PW_ALL_BROWSERS: "1" },
});
process.exit(result.status ?? 1);
