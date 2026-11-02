// SPSS and Stata in a real browser under the strict content policy (specs/017): a file goes in, only its structure is
// shown, it is profiled like a CSV, and a fake CSV comes out with the same variables. The reader is served by the site.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../fixtures/stat");
const APP = "/APP-synthetic-data-generator/";
const region = (page: Page) => page.getByRole("region", { name: "Generate the fake table" });

for (const [name, label] of [
  ["survey.sav", "SPSS"],
  ["survey.dta", "Stata"],
] as const) {
  test(`${name}: structure only, profiled, and written as a fake CSV`, async ({
    page,
  }, testInfo) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.goto(APP);
    await page.locator("#file-input").setInputFiles(join(FIX, name));
    const summary = page.getByTestId("stat-summary");
    await expect(summary).toBeVisible({ timeout: 60_000 });
    await expect(summary.getByRole("heading", { name: `${label} file` })).toBeVisible();
    await expect(summary).toContainText("120 rows, 6 variables");
    const shown = await page.locator("body").innerText();
    expect(shown).not.toContain("H1000"); // no value from the file is shown

    await page.getByRole("button", { name: "Profile this file" }).click();
    await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({
      timeout: 180_000,
    });
    await page.getByRole("button", { name: "Continue to Generate" }).click();
    await page.getByLabel("Seed").fill("42");
    await region(page).getByRole("button", { name: "Generate", exact: true }).click();
    await expect(page.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({
      timeout: 180_000,
    });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Download survey_fake\.csv/ }).click(),
    ]);
    const path = testInfo.outputPath("fake.csv");
    await download.saveAs(path);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines[0]).toBe("hh_id,age,income,mode,has_pass,trip_date");
    expect(lines).toHaveLength(121);

    const origin = new URL(page.url()).origin;
    expect(
      requests.filter(
        (u) => !u.startsWith(origin) && !u.startsWith("blob:") && !u.startsWith("data:"),
      ),
    ).toEqual([]);
  });
}

test("a file named .sav that is not an SPSS file is refused with a fixed message", async ({
  page,
}) => {
  await page.goto(APP);
  await page
    .locator("#file-input")
    .setInputFiles({
      name: "fake.sav",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("not an spss file at all"),
    });
  await expect(page.getByRole("alert")).toContainText("could not be read", { timeout: 60_000 });
});
