// Spike R1 (T016): can a ~500 MB CSV be read straight from the browser File into an in-memory
// all-text DuckDB table, and what does it cost? Needs `npm run fixtures -- --large` first.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));

const FIXTURE = join(HERE, "../../../.fixtures/zoo_500mb.csv");
const PAGE = "/APP-synthetic-data-generator/spike.html";

test.skip(!existsSync(FIXTURE), "run `node scripts/make-fixtures.mjs --large` first");

test("a 500 MB CSV loads into an in-memory all-text table", async ({ page }) => {
  await page.goto(PAGE);
  await page.setInputFiles("#files", FIXTURE);
  const result = await page.evaluate(() => (window as never as { spike: { memory(): Promise<unknown> } }).spike.memory());
  console.log("MEMORY SPIKE RESULT", JSON.stringify(result));
  expect(result).toMatchObject({ columns: 123 });
  expect((result as { rows: number }).rows).toBeGreaterThan(390000);
});
