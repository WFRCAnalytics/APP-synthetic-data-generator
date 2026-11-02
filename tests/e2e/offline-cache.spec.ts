// The app keeps working when the network goes away after the page has loaded (specs/034). The hosted page keeps its own files in an
// offline copy (the page, scripts, the data engine and the file readers); here a local build asks for it with ?cache. The network is then
// switched off in the browser and a file is opened, profiled, faked and downloaded, in every browser.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const APP = "/APP-synthetic-data-generator/?cache";
const NL = String.fromCharCode(10);
const csv = ["id,zone,income"].concat(Array.from({ length: 200 }, (_, i) => `H${1000 + i},${["north", "south", "east"][i % 3]},${20000 + ((i * 977) % 90000)}`)).join(NL) + NL;

async function offlineReady(page: Page) {
  await page.goto(APP);
  await page.getByRole("button", { name: "Stays on this device" }).click();
  await page.getByRole("tab", { name: "Stored and held" }).click();
  await expect(page.getByTestId("pm-offline")).toContainText("saved", { timeout: 180_000 });
  await expect(page.getByTestId("pm-offline")).toContainText("keeps working");
  await page.keyboard.press("Escape");
}

test("the app keeps its own files, and a file can still be opened, faked and downloaded with the network off", async ({ page, context }) => {
  await offlineReady(page);
  await context.setOffline(true);

  // A fresh visit while offline also loads, from the saved copy.
  await page.reload();
  await expect(page.getByRole("heading", { name: /Make test data/ })).toBeVisible();

  await page.locator("#file-input").setInputFiles({ name: "survey.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: /profile this file/i }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await page.getByRole("region", { name: "Generate the fake table" }).getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText(/checks passed\./)).toBeVisible({ timeout: 120_000 });
  const [fake] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download survey_fake\.csv/ }).click()]);
  expect(readFileSync(await fake.path(), "utf8").trim().split(NL).length).toBe(201);
  await context.setOffline(false);
});

test("a workbook, whose reader is loaded on demand, also works with the network off", async ({ page, context }) => {
  await offlineReady(page);
  await context.setOffline(true);
  await page.locator("#file-input").setInputFiles("tests/fixtures/xlsx/quirks.xlsx");
  await expect(page.getByRole("heading", { name: "Choose a sheet" })).toBeVisible({ timeout: 120_000 });
  await page.getByLabel("Sheet", { exact: true }).selectOption({ label: "Survey Data" });
  await page.getByRole("button", { name: "Use this sheet" }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 180_000 });
  await context.setOffline(false);
});
