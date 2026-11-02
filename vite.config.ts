import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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

// The offline copy (specs/034): writes sw.js beside the page, from src/sw/sw.template.js, with the list of the site's own files. The
// files every visitor needs are `core`; the data engine and the file readers come in two builds (eh, mvp) and a browser uses one.
function offlineWorker(): Plugin {
  let outDir = "dist";
  const walk = (dir: string, base = ""): string[] =>
    readdirSync(dir).flatMap((name) => {
      const rel = base ? `${base}/${name}` : name;
      return statSync(join(dir, name)).isDirectory() ? walk(join(dir, name), rel) : [rel];
    });
  return {
    name: "offline-worker",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const root = resolve(outDir);
      const files = walk(root).filter((f) => f !== "sw.js" && f !== "spike.html" && !f.endsWith(".map"));
      const entry = (path: string) => ({ path, size: statSync(join(root, path)).size });
      const variantOf = (f: string): "eh" | "mvp" | null => {
        if (/^duckdb\/duckdb-(browser-)?eh[.-]/.test(f) || f.includes("/wasm_eh/")) return "eh";
        if (/^duckdb\/duckdb-(browser-)?mvp[.-]/.test(f) || f.includes("/wasm_mvp/")) return "mvp";
        return null;
      };
      const manifest = { core: [] as ReturnType<typeof entry>[], eh: [] as ReturnType<typeof entry>[], mvp: [] as ReturnType<typeof entry>[] };
      for (const f of files) manifest[variantOf(f) ?? "core"].push(entry(f));
      const id = createHash("sha1").update(JSON.stringify(manifest)).digest("hex").slice(0, 12);
      const template = readFileSync(new URL("./src/sw/sw.template.js", import.meta.url), "utf8");
      writeFileSync(join(root, "sw.js"), template.replace('"__BUILD_ID__"', JSON.stringify(`${APP_VERSION}-${id}`)).replace('"__MANIFEST__"', JSON.stringify(manifest)));
    },
  };
}

// `vite build --mode spike` also builds spike.html (prototype pages used by tests/e2e/spikes).
export default defineConfig(({ mode }) => ({
  base: BASE,
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [react(), cspMeta(), offlineWorker()],
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
