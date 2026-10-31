// Slice 3 spike R1: does the self-hosted Excel extension load under the strict CSP, and what does the
// reader return for a workbook with the usual quirks? Results are printed for research.md.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, "../../fixtures/xlsx/quirks.xlsx");
const PAGE = "/APP-synthetic-data-generator/spike.html";

test.skip(!existsSync(FILE), "run the xlsx fixture script first");

test("the Excel extension loads from the site and reads the workbook", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(PAGE);
  await page.setInputFiles("#files", FILE);
  const result = await page.evaluate(() => (window as never as { spike: { excel(): Promise<unknown> } }).spike.excel());
  console.log("EXCEL SPIKE RESULT", JSON.stringify(result, null, 1));
  const foreign = requests.filter((u) => !u.startsWith("http://localhost") && !u.startsWith("blob:") && !u.startsWith("data:"));
  console.log("EXCEL SPIKE foreign requests", JSON.stringify(foreign));
  expect(foreign).toEqual([]);
});
