// The whole first slice in a real browser under the strict CSP: choose a CSV, confirm the detected
// settings, review the columns, generate, check the table, and download the fake file.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const ZOO = join(HERE, "../fixtures/zoo");
const APP = "/APP-synthetic-data-generator/";

test("a CSV goes in and a fake CSV comes out, entirely on this device", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));

  await page.goto(APP);
  await expect(page.getByRole("heading", { name: "Choose a file" })).toBeVisible();

  // Ingest: choose the file and confirm what was detected.
  await page.locator("#file-input").setInputFiles(join(ZOO, "zoo_small.csv"));
  await expect(page.getByRole("heading", { name: "Detected settings" })).toBeVisible();
  await expect(page.locator("#delimiter")).toHaveValue(",");
  await expect(page.locator("#encoding")).toHaveValue("utf-8");
  await page.getByRole("button", { name: /profile this file/i }).click();

  // Review: one card per column.
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 120_000 });
  await expect(page.locator(".column-card")).toHaveCount(82);
  await expect(page.locator('[data-column="cat_str_5"]')).toContainText("Categorical");
  await expect(page.locator('[data-column="email"]')).toContainText("Left out");
  await expect(page.locator('[data-column="int_sentinels"]')).toContainText("Needs attention");

  // No real personal value is anywhere on the page.
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/@example\.com/);

  // Generate.
  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await expect(page.getByRole("heading", { name: "Generate the fake table" })).toBeVisible();
  await page.getByRole("region", { name: "Generate the fake table" }).getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText(/checks passed\./)).toBeVisible({ timeout: 120_000 });
  await expect(page.locator(".preview-table tbody tr")).toHaveCount(50);

  // Export.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Download zoo_small_fake\.csv/ }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("zoo_small_fake.csv");
  const fake = readFileSync(await download.path(), "utf8");
  const header = fake.split("\n")[0];
  expect(header.startsWith("bool_tf,bool_yn,bool_yesno,bool_01")).toBe(true);
  expect(header).not.toContain("email");
  expect(fake).not.toMatch(/@example\.com/);

  // Everything stayed on this device.
  const origin = new URL(page.url()).origin;
  const foreign = requests.filter((u) => !u.startsWith(origin) && !u.startsWith("blob:") && !u.startsWith("data:"));
  expect(foreign).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("a bad file shows a clear message with no cell value", async ({ page }) => {
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles(join(ZOO, "ragged.csv"));
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("could not be read as CSV");
  await expect(alert).not.toContainText("4,5");
});

test("an empty file is reported", async ({ page }) => {
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles(join(ZOO, "empty.csv"));
  await expect(page.getByRole("alert")).toContainText("The file is empty");
});

test("reloading the page clears everything", async ({ page }) => {
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles(join(ZOO, "variant_utf8.csv"));
  await expect(page.getByRole("heading", { name: "Detected settings" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Choose a file" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Detected settings" })).toHaveCount(0);
});
