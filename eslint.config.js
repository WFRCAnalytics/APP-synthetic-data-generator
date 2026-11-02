// The lint rules of the project, in ESLint's flat config format. Same checks as the old `.eslintrc.cjs`: the recommended
// JavaScript and TypeScript rules, the rules of hooks, the fast-refresh warning, Prettier's formatting left to Prettier,
// and the rule that only one file may import the faker word lists (specs/002 research R1, R11).

import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "dist-spike",
      "test-results",
      "playwright-report",
      "coverage",
      "public",
      ".fixtures",
      "node_modules",
      ".specify",
      ".claude",
      "release-out",
      "*.min.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node, ...globals.es2021 },
    },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      // The two classic rules of hooks; the newer compiler-based rules of the plugin are not part of this check.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // Faker word lists are only for the generating step (specs/002 research R1, R11).
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@faker-js/faker", "@faker-js/faker/*"],
              message:
                "Import faker data only in src/lib/textgen/wordlists.ts, which only the generate worker loads.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/textgen/wordlists.ts", "tests/**", "scripts/**"],
    rules: { "no-restricted-imports": "off" },
  },
  prettier,
);
