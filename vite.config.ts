import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { DEV_CSP, STRICT_CSP } from "./vite.csp";

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

export default defineConfig({
  base: BASE,
  plugins: [react(), cspMeta()],
  worker: { format: "es" },
  build: { target: "es2022" },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}", "tests/component/**/*.test.{ts,tsx}"],
  },
});
