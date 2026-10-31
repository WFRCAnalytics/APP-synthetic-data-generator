// FR-017: the self-hosted Excel extension loads under the strict content policy and reads a small
// workbook, with no policy violation and no request outside the site. Runs in CI before every deploy,
// because a new DuckDB version or a failed extension download would otherwise break Excel silently.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, "../fixtures/xlsx/plain.xlsx");

test.skip(!existsSync(FILE), "run scripts/make-xlsx-fixtures.py first");

test("the Excel extension loads from the site and reads a small workbook", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/APP-synthetic-data-generator/spike.html");
  await page.setInputFiles("#files", FILE);
  const result = await page.evaluate(() => (window as never as { spike: { excelSmoke(): Promise<unknown> } }).spike.excelSmoke());
  expect(result).toMatchObject({ loaded: 1, rows: 100, columns: ["id", "name", "score", "visited", "category"], violations: [] });
  const origin = new URL(page.url()).origin;
  expect(requests.filter((u) => !u.startsWith(origin) && !u.startsWith("blob:") && !u.startsWith("data:"))).toEqual([]);
  expect(requests.some((u) => u.includes("/duckdb-ext/") && u.endsWith("excel.duckdb_extension.wasm"))).toBe(true);
});
