// Any upload can be written back as another file type (specs/020): the choice is on Generate, the same kind as the file that
// was opened is the default, and each file is the type it says it is.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const APP = "/APP-synthetic-data-generator/";
const region = (page: Page) => page.getByRole("region", { name: "Generate the fake table" });

const csv = ["trip_id,age,income,mode,trip_date"].concat(Array.from({ length: 200 }, (_, i) => `T${1000 + i},${18 + (i % 60)},${(20000 + i * 137.25).toFixed(2)},${["car", "bus", "walk"][i % 3]},2024-0${1 + (i % 9)}-1${i % 9}`)).join("\n") + "\n";

async function toGenerate(page: Page) {
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles({ name: "trips.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: /profile this file/i }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "Continue to Generate" }).click();
}

async function generate(page: Page) {
  await page.getByLabel("Seed").fill("3");
  await region(page).getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({ timeout: 120_000 });
}

test("a CSV is written as a CSV by default, and the other file types are the choice", async ({ page }) => {
  await toGenerate(page);
  const select = page.locator("#output-kind");
  await expect(select).toHaveValue("same");
  await expect(select.locator("option")).toHaveText([/CSV.*same as the file you opened/, /Excel/, /Parquet/, /JSON \(a list/, /JSON Lines/, /SPSS/, /Stata/, /SAS transport/]);
  await generate(page);
  await expect(page.getByRole("button", { name: "Download trips_fake.csv" })).toBeVisible();
});

for (const [value, ext, magic, at] of [
  ["sav", "sav", "$FL2", 0],
  ["dta", "dta", "<stata_dta>", 0],
  ["xpt", "xpt", "HEADER RECORD*******LIBRARY", 0],
  ["xlsx", "xlsx", "PK", 0],
  ["parquet", "parquet", "PAR1", 0],
  ["json", "json", "[", 0],
  ["ndjson", "ndjson", "{", 0],
] as const) {
  test(`a CSV can be written as ${ext}`, async ({ page }) => {
    await toGenerate(page);
    await page.locator("#output-kind").selectOption(value);
    await generate(page);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: `Download trips_fake.${ext}` }).click()]);
    const bytes = readFileSync(await download.path());
    expect(bytes.subarray(at, at + magic.length).toString("latin1")).toBe(magic);
    expect(bytes.length).toBeGreaterThan(500);
    // The README and the zip follow the choice.
    const [readme] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download README for agents" }).click()]);
    expect(readme.suggestedFilename()).toBe(`trips_fake_README.md`);
    const [zip] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download all (zip)" }).click()]);
    expect(readFileSync(await zip.path()).includes(Buffer.from(`trips_fake.${ext}`))).toBe(true);
  });
}
