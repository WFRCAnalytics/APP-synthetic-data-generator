/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
    "prettier",
  ],
  ignorePatterns: ["dist", "dist-spike", "test-results", "playwright-report", "coverage", "public", ".fixtures", "node_modules", ".eslintrc.cjs", ".specify", ".claude"],
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: "latest", sourceType: "module" },
  plugins: ["react-refresh"],
  rules: {
    "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    // Faker word lists are only for the generating step (specs/002 research R1, R11).
    "no-restricted-imports": ["error", { patterns: [{ group: ["@faker-js/faker", "@faker-js/faker/*"], message: "Import faker data only in src/lib/textgen/wordlists.ts, which only the generate worker loads." }] }],
  },
  overrides: [{ files: ["src/lib/textgen/wordlists.ts", "tests/**", "scripts/**"], rules: { "no-restricted-imports": "off" } }],
};
