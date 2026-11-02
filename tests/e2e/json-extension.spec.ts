// specs/007 R1, T003a: the self-hosted JSON extension loads in the built app under the strict content
// policy and reads a small file as records, with no policy violation and no request outside the site.
// Runs in CI before every deploy and release, because a new DuckDB version or a failed extension download
// would otherwise break JSON silently.
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = [
  { file: join(HERE, "../fixtures/json/survey.json"), rows: 400 },
  { file: join(HERE, "../fixtures/json/survey.ndjson"), rows: 400 },
];

for (const { file, rows } of FILES) {
  test.describe(basename(file), () => {
    test.skip(!existsSync(file), "run scripts/make-json-fixtures.py first");

    test("the JSON extension loads from the site and reads the records", async ({ page }) => {
      const requests: string[] = [];
      page.on("request", (r) => requests.push(r.url()));
      await page.goto("/APP-synthetic-data-generator/spike.html");
      await page.setInputFiles("#files", file);
      const result = await page.evaluate(() => (window as never as { spike: { jsonSmoke(): Promise<unknown> } }).spike.jsonSmoke());
      expect(result).toMatchObject({ loaded: 1, rows, violations: [] });
      const origin = new URL(page.url()).origin;
      expect(requests.filter((u) => !u.startsWith(origin) && !u.startsWith("blob:") && !u.startsWith("data:"))).toEqual([]);
      expect(requests.some((u) => u.includes("/duckdb-ext/") && u.endsWith("json.duckdb_extension.wasm"))).toBe(true);
    });
  });
}
