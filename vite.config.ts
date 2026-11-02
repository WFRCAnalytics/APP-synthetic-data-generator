import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { DEV_CSP, STRICT_CSP } from "./vite.csp.ts";

// The app version shown in the page and used to name a release comes from package.json alone.
const APP_VERSION = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version;

// Static site on GitHub Pages: `base` must match the repository name so built asset URLs resolve
// under the project-pages subpath. Pages deploys from a GitHub Actions workflow (a later feature),
// so build output goes to the default, git-ignored `dist/`.
const BASE = "/APP-synthetic-data-generator/";

// Replaces the <!--CSP--> placeholder in index.html with the policy for the current mode.
function cspMeta(): Plugin {
  return {
    name: "csp-meta",
    transformIndexHtml(html, ctx) {
      const policy = ctx.server ? DEV_CSP : STRICT_CSP;
      return html.replace(
        "<!--CSP-->",
        `<meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      );
    },
  };
}

// `vite build --mode spike` also builds spike.html (prototype pages used by tests/e2e/spikes).
export default defineConfig(({ mode }) => ({
  base: BASE,
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [react(), cspMeta()],
  worker: { format: "es" },
  build: {
    target: "es2022",
    outDir: mode === "spike" ? "dist-spike" : "dist",
    rolldownOptions: mode === "spike" ? { input: { main: "index.html", spike: "spike.html" } } : undefined,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    // The type-zoo round trips profile and generate whole tables; with the other test files running beside them they
    // need more than the default five seconds on a busy machine.
    testTimeout: 30_000,
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}", "tests/component/**/*.test.{ts,tsx}"],
  },
}));
