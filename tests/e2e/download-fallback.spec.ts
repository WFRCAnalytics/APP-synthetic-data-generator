// FR-029, FR-036: every supported browser gets the fake file as one ordinary download. Chrome and
// Edge could one day offer folder output; Firefox and Safari never need it. Run in all three engines
// with `npm run test:e2e:browsers` (needs `npx playwright install firefox webkit` once).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = "/APP-synthetic-data-generator/";

test("the fake CSV and the spec each download as a single file", async ({ page }) => {
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles(join(HERE, "../fixtures/zoo/zoo_small.csv"));
  await expect(page.getByRole("heading", { name: "Detected settings" })).toBeVisible();
  await page.getByRole("button", { name: /profile this file/i }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 180_000 });

  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await page.getByRole("region", { name: "Generate the fake table" }).getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText(/checks passed\./)).toBeVisible({ timeout: 180_000 });

  const [fake] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download zoo_small_fake\.csv/ }).click()]);
  expect(fake.suggestedFilename()).toBe("zoo_small_fake.csv");
  const csv = readFileSync(await fake.path(), "utf8");
  expect(csv.split("\n")[0].startsWith("bool_tf,bool_yn")).toBe(true);
  expect(csv.split("\n").length).toBeGreaterThan(1000);

  const [spec] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download spec/ }).click()]);
  expect(spec.suggestedFilename()).toBe("zoo_small_spec.json");
  const json = JSON.parse(readFileSync(await spec.path(), "utf8"));
  expect(json.spec_version).toBe(5);
  expect(json.columns.length).toBeGreaterThan(50);
});
