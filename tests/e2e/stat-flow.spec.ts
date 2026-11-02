// SPSS and Stata in a real browser under the strict content policy (specs/017, specs/018): a file goes in, only its
// structure is shown, it is profiled like a CSV, and a fake file comes out in the same kind of file (CSV is the other
// choice). The reader is served by the site, and the fake file opens again with the same shape.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { shownCard } from "../helpers/review";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../fixtures/stat");
const APP = "/APP-synthetic-data-generator/";
const region = (page: Page) => page.getByRole("region", { name: "Generate the fake table" });

async function generate(page: Page) {
  await page.getByLabel("Seed").fill("42");
  await region(page).getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({ timeout: 180_000 });
}

for (const [name, label, magic, readmeText] of [
  ["survey.sav", "SPSS", "$FL2", "An SPSS data file"],
  ["survey.dta", "Stata", "<stata_dta>", "A Stata data file"],
] as const) {
  test(`${name}: structure only, profiled, written as the same kind of file or as CSV`, async ({ page }, testInfo) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.goto(APP);
    await page.locator("#file-input").setInputFiles(join(FIX, name));
    const summary = page.getByTestId("stat-summary");
    await expect(summary).toBeVisible({ timeout: 60_000 });
    await expect(summary.getByRole("heading", { name: `${label} file` })).toBeVisible();
    await expect(summary).toContainText("120 rows, 6 variables");
    expect(await page.locator("body").innerText()).not.toContain("H1000"); // no value from the file is shown
    await expect(page.getByTestId("stat-labels")).toContainText("4 codes mean");

    await page.getByRole("button", { name: "Profile this file" }).click();
    await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 180_000 });
    // The labels of the codes are beside the column, taken from the file.
    await shownCard(page, "mode");
    await expect(page.getByLabel("Value labels of mode")).toContainText("Bus");
    await page.getByRole("button", { name: "Continue to Generate" }).click();
    await generate(page);

    // The default file type is the one that was opened.
    await expect(page.locator("#output-kind")).toHaveValue("same");
    const ext = name.slice(name.lastIndexOf("."));
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: `Download survey_fake${ext}` }).click()]);
    const path = testInfo.outputPath(`fake${ext}`);
    await download.saveAs(path);
    expect(readFileSync(path).subarray(0, magic.length).toString("latin1")).toBe(magic);

    // The README says what kind of file it is.
    const [readme] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download README for agents" }).click()]);
    const readmePath = testInfo.outputPath("readme.md");
    await readme.saveAs(readmePath);
    const readmeBody = readFileSync(readmePath, "utf8");
    expect(readmeBody).toContain(readmeText);
    expect(readmeBody).toContain("(Bus)");

    // CSV is the other choice.
    await page.locator("#output-kind").selectOption("csv");
    const [csvDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download survey_fake.csv" }).click()]);
    const csvPath = testInfo.outputPath("fake.csv");
    await csvDownload.saveAs(csvPath);
    const lines = readFileSync(csvPath, "utf8").trim().split("\n");
    expect(lines[0]).toBe("hh_id,age,income,mode,has_pass,trip_date");
    expect(lines).toHaveLength(121);

    // The fake file opens again with the same shape.
    await page.goto(APP);
    await page.locator("#file-input").setInputFiles(path);
    await expect(page.getByTestId("stat-summary")).toContainText("120 rows, 6 variables", { timeout: 60_000 });

    const origin = new URL(page.url()).origin;
    expect(requests.filter((u) => !u.startsWith(origin) && !u.startsWith("blob:") && !u.startsWith("data:"))).toEqual([]);
  });
}

test("a file named .sav that is not an SPSS file is refused with a fixed message", async ({ page }) => {
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles({ name: "fake.sav", mimeType: "application/octet-stream", buffer: Buffer.from("not an spss file at all") });
  await expect(page.getByRole("alert")).toContainText("could not be read", { timeout: 60_000 });
});
