// Excel quirks through the whole app (specs/003 FR-004 to FR-008, FR-012): number formats, text that looks
// like numbers, dates in both date systems and times survive a round trip, and the fake workbook is read
// back by an independent reader (openpyxl) with the same cell formats and kinds. No cell value is checked
// against the real one; only formats, kinds and ranges.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../fixtures/xlsx");
const APP = "/APP-synthetic-data-generator/";
const region = (page: Page) => page.getByRole("region", { name: "Generate the fake table" });
const hasOpenpyxl = spawnSync("python", ["-c", "import openpyxl"]).status === 0;

async function fakeOf(page: Page, name: string, sheet: string, path: string) {
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles(join(FIX, name));
  await expect(page.getByRole("heading", { name: "Choose a sheet" })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Sheet", { exact: true }).selectOption({ label: sheet });
  await expect(page.getByLabel("Rows to skip")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Use this sheet" }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 180_000 });
  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await region(page).getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({ timeout: 180_000 });
  // Only a mean over these 60 rows may differ (sampling noise, as for a CSV this small); nothing structural.
  const differing = await page.locator("tr[data-pass='false'] td:nth-child(2)").allTextContents();
  expect(differing.filter((metric) => metric !== "mean")).toEqual([]);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download .*_fake\.xlsx/ }).click()]);
  await download.saveAs(path);
}

const PROBE = [
  "import openpyxl, json, sys",
  "def read(path, sheet):",
  "    wb = openpyxl.load_workbook(path)",
  "    ws = wb[sheet]",
  "    cols = list(zip(*[[c for c in row] for row in ws.iter_rows(min_row=2)]))",
  "    return {",
  "        'epoch': wb.epoch.year,",
  "        'header': [c.value for c in ws[1]],",
  "        'rows': ws.max_row,",
  "        'formats': [c.number_format for c in ws[2]],",
  "        'kinds': [sorted({c.data_type for c in col if c.value is not None}) for col in cols],",
  "        'blank': [sum(1 for c in col if c.value is None) for col in cols],",
  "    }",
  "print(json.dumps({'real': read(sys.argv[1], sys.argv[3]), 'fake': read(sys.argv[2], sys.argv[3])}))",
].join("\n");

function compare(real: string, fake: string, sheet: string) {
  const r = spawnSync("python", ["-c", PROBE, real, fake, sheet], { encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as { real: Record<string, unknown>; fake: Record<string, unknown> };
}

test.describe("formats.xlsx", () => {
  test.skip(!hasOpenpyxl, "needs Python with openpyxl");

  test("percent, currency, scientific, text, thousands, decimals, dates and times keep their formats and kinds", async ({ page }, testInfo) => {
    const fake = testInfo.outputPath("formats_fake.xlsx");
    await fakeOf(page, "formats.xlsx", "Formats", fake);
    const { real, fake: made } = compare(join(FIX, "formats.xlsx"), fake, "Formats");
    expect(made.header).toEqual(real.header);
    expect(made.rows).toBe(real.rows);
    expect(made.formats).toEqual(real.formats);
    expect(made.kinds).toEqual(real.kinds);
    // The text column that looks like numbers (leading zeros) stays text.
    expect((made.kinds as string[][])[3]).toEqual(["s"]);
  });
});

test.describe("dates1904.xlsx", () => {
  test.skip(!hasOpenpyxl, "needs Python with openpyxl");

  test("the 1904 date system and both date formats are kept", async ({ page }, testInfo) => {
    const fake = testInfo.outputPath("dates_fake.xlsx");
    await fakeOf(page, "dates1904.xlsx", "Dates", fake);
    const { real, fake: made } = compare(join(FIX, "dates1904.xlsx"), fake, "Dates");
    expect(made.epoch).toBe(1904);
    expect(made.formats).toEqual(real.formats);
    expect(made.kinds).toEqual(real.kinds);
    expect(made.rows).toBe(real.rows);
  });
});
