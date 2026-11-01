// specs/005 R1, T003a: the self-hosted Parquet extension loads in the built app under the strict content
// policy and reads a small file, with no policy violation and no request outside the site. Runs in CI
// before every deploy and release, because a new DuckDB version or a failed extension download would
// otherwise break Parquet silently.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, "../fixtures/parquet/plain.parquet");

test.skip(!existsSync(FILE), "run scripts/make-parquet-fixtures.py first");

test("the Parquet extension loads from the site and reads a small file", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/APP-synthetic-data-generator/spike.html");
  await page.setInputFiles("#files", FILE);
  const result = await page.evaluate(() => (window as never as { spike: { parquetSmoke(): Promise<unknown> } }).spike.parquetSmoke());
  expect(result).toMatchObject({ loaded: 1, rows: 5000, columns: ["id16", "id64", "f64", "name", "day"], groups: 5, violations: [] });
  const origin = new URL(page.url()).origin;
  expect(requests.filter((u) => !u.startsWith(origin) && !u.startsWith("blob:") && !u.startsWith("data:"))).toEqual([]);
  expect(requests.some((u) => u.includes("/duckdb-ext/") && u.endsWith("parquet.duckdb_extension.wasm"))).toBe(true);
});
