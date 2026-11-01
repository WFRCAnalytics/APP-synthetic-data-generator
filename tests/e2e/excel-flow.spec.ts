// Excel in a real browser under the strict content policy (specs/003 FR-001 to FR-020): a workbook goes
// in through the load dialog, is profiled like a CSV, a fake workbook comes out, and that download is read
// again through the app to compare sheet, header position, column types and formats. The extension that
// reads the workbook is served by the site itself.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../fixtures/xlsx");
const APP = "/APP-synthetic-data-generator/";
const region = (page: Page) => page.getByRole("region", { name: "Generate the fake table" });

async function chooseWorkbook(page: Page, name: string, sheet: string) {
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles(join(FIX, name));
  await expect(page.getByRole("heading", { name: "Choose a sheet" })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Sheet", { exact: true }).selectOption({ label: sheet });
  await expect(page.getByLabel("Rows to skip above the header")).toBeVisible({ timeout: 60_000 });
}

async function review(page: Page) {
  await page.getByRole("button", { name: "Use this sheet" }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 180_000 });
}

/** The type shown on every card, by column name. */
async function types(page: Page): Promise<Record<string, string>> {
  return page.locator(".column-card").evaluateAll((cards) =>
    Object.fromEntries(cards.map((c) => [c.getAttribute("data-column") as string, (c.querySelector(".badge")?.textContent ?? "").trim()])),
  );
}

async function generateAndDownload(page: Page) {
  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await region(page).getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({ timeout: 180_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download .*_fake\.xlsx/ }).click()]);
  return download;
}

test("the load dialog lists the sheets by name only and suggests where the table starts", async ({ page }) => {
  await chooseWorkbook(page, "quirks.xlsx", "Survey Data");
  const options = await page.getByLabel("Sheet", { exact: true }).locator("option").allTextContents();
  expect(options).toEqual(["Notes", "Survey Data", "Lookup (hidden)"]);
  await expect(page.getByTestId("skip-suggestion")).toContainText("Suggested: 2");
  await expect(page.getByLabel("Cell range (optional)")).toHaveValue("A3:I203");
  await expect(page.getByTestId("merged-note")).toBeVisible();

  // No cell value, comment or other sheet's content is on the page.
  const text = await page.locator("body").innerText();
  for (const secret of ["comment number", "Merged heading", "PRIVATE-MARKER", "secret"]) expect(text).not.toContain(secret);

  await page.getByLabel("Sheet", { exact: true }).selectOption({ label: "Lookup (hidden)" });
  await expect(page.getByTestId("sheet-hidden-note")).toBeVisible();
});

test("a workbook goes in and a fake workbook comes out, and reads back the same", async ({ page }, testInfo) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));

  await chooseWorkbook(page, "quirks.xlsx", "Survey Data");
  await review(page);
  const realTypes = await types(page);
  expect(Object.keys(realTypes)).toEqual(["resp_id", "zip", "amount", "share", "when", "score", "flag", "note", "total"]);
  expect(realTypes.when).toBe("Date");
  expect(realTypes.amount).toBe("Decimal");
  expect(realTypes.resp_id).toBe("Survey ID");

  const download = await generateAndDownload(page);
  expect(download.suggestedFilename()).toBe("quirks_fake.xlsx");
  const fakePath = testInfo.outputPath("quirks_fake.xlsx");
  await download.saveAs(fakePath);

  // Read the fake workbook again through the app, with the same choices.
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles(fakePath);
  await expect(page.getByRole("heading", { name: "Choose a sheet" })).toBeVisible({ timeout: 60_000 });
  const options = await page.getByLabel("Sheet", { exact: true }).locator("option").allTextContents();
  expect(options).toEqual(["Survey Data"]); // only the chosen sheet is in the fake workbook
  await expect(page.getByLabel("Rows to skip above the header")).toHaveValue("2", { timeout: 60_000 });
  await review(page);
  expect(await types(page)).toEqual(realTypes);

  // Nothing left the site.
  const origin = new URL(page.url()).origin;
  expect(requests.filter((u) => !u.startsWith(origin) && !u.startsWith("blob:") && !u.startsWith("data:"))).toEqual([]);
  expect(requests.some((u) => u.includes("/duckdb-ext/") && u.endsWith("excel.duckdb_extension.wasm"))).toBe(true);
});

const hasOpenpyxl = spawnSync("python", ["-c", "import openpyxl"]).status === 0;

test("openpyxl, an independent reader, sees the same sheet, header, formats and text cells (a formula column reads as its value)", async ({ page }, testInfo) => {
  test.skip(!hasOpenpyxl, "needs Python with openpyxl");
  await chooseWorkbook(page, "quirks.xlsx", "Survey Data");
  await review(page);
  const fakePath = testInfo.outputPath("quirks_fake.xlsx");
  await (await generateAndDownload(page)).saveAs(fakePath);

  const code = [
    "import openpyxl, json, sys",
    "def read(path):",
    "    ws = openpyxl.load_workbook(path)['Survey Data']",
    "    return {'sheets': openpyxl.load_workbook(path).sheetnames, 'header': [c.value for c in ws[3]][:9], 'formats': [c.number_format for c in ws[5]][:9], 'types': [c.data_type for c in ws[5]][:9], 'rows': ws.max_row, 'first_two_empty': all(c.value is None for c in ws[1]) and all(c.value is None for c in ws[2])}",
    "print(json.dumps({'real': read(sys.argv[1]), 'fake': read(sys.argv[2])}))",
  ].join("\n");
  const r = spawnSync("python", ["-c", code, join(FIX, "quirks.xlsx"), fakePath], { encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  const { real, fake } = JSON.parse(r.stdout);
  expect(fake.sheets).toEqual(["Survey Data"]);
  expect(fake.header).toEqual(real.header);
  expect(fake.rows).toBe(real.rows);
  expect(fake.first_two_empty).toBe(true);
  expect(fake.formats).toEqual(real.formats);
  // resp_id and zip are text in both; amount, share, when and score are numbers or dates in both. The
  // last column is a formula in the real sheet, which is read as its value (a number) in the fake one.
  expect(fake.types.slice(0, 8)).toEqual(real.types.slice(0, 8));
  expect(real.types[8]).toBe("f");
  expect(fake.types[8]).toBe("n");
});

test("the saved spec records the sheet, range, rows skipped and formats, and no cell value", async ({ page }, testInfo) => {
  await chooseWorkbook(page, "quirks.xlsx", "Survey Data");
  await review(page);
  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await region(page).getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({ timeout: 180_000 });
  const [specDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download spec/ }).click()]);
  const path = testInfo.outputPath("spec.json");
  await specDownload.saveAs(path);
  const text = readFileSync(path, "utf8");
  const spec = JSON.parse(text);

  expect(spec.spec_version).toBe(4);
  expect(spec.source).toEqual({ format: "xlsx", file_name: "quirks.xlsx", sheet: "Survey Data", range: "A3:I203", skip_rows: 2, header: true, date1904: false });
  const byName = Object.fromEntries(spec.columns.map((c: { name: string }) => [c.name, c]));
  expect(byName.amount.cell_format).toBe("#,##0.00");
  expect(byName.share.cell_format).toBe("0.0%");
  expect(byName.when.cell_format).toBe("mm/dd/yyyy");
  expect(byName.zip.stored_as_text).toBe(true); // numbers stored as text stay text
  expect(text.length).toBeLessThan(1_000_000);
  for (const secret of ["comment number", "Merged heading", "PRIVATE-MARKER", "00042"]) expect(text).not.toContain(secret);
});

test("loading that spec without the workbook generates a workbook again", async ({ page }, testInfo) => {
  await chooseWorkbook(page, "quirks.xlsx", "Survey Data");
  await review(page);
  await page.getByRole("button", { name: "Save spec (JSON)" }).click().catch(() => {});
  const [saved] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save spec (JSON)" }).click()]);
  const specPath = testInfo.outputPath("spec.json");
  await saved.saveAs(specPath);

  await page.goto(APP);
  await page.getByLabel("Load existing spec").setInputFiles(specPath);
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await expect(region(page).getByTestId("spec-only-banner")).toBeVisible();
  await region(page).getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({ timeout: 180_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download .*_fake\.xlsx/ }).click()]);
  expect(download.suggestedFilename()).toBe("quirks_fake.xlsx");
});

// ---- Nothing real is kept, nothing leaves the device (specs/003 FR-016, FR-018, FR-019) --------------

test("no marker from other sheets, titles, comments or cells is in the page, spec, preview, download or storage", async ({ page }, testInfo) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  const MARK = "PRIVATE-MARKER";

  await chooseWorkbook(page, "titles.xlsx", "Responses");
  const leaks = async (stage: string) => {
    const html = await page.content();
    expect(html, `visible at ${stage}`).not.toContain(MARK);
  };
  await leaks("the load dialog");
  await review(page);
  await leaks("review");

  const download = await generateAndDownload(page);
  await leaks("generate and preview");
  const fakePath = testInfo.outputPath("fake.xlsx");
  await download.saveAs(fakePath);
  // The workbook is a zip, so look inside it for the markers.
  const { spawnSync: run } = await import("node:child_process");
  const hasPython = run("python", ["-c", "import zipfile"]).status === 0;
  if (hasPython) {
    const code = "import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1])\nprint(b''.join(z.read(n) for n in z.namelist()).decode('utf8','ignore'))";
    const inside = run("python", ["-c", code, fakePath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout;
    expect(inside).not.toContain(MARK);
  }

  const [specDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download spec/ }).click()]);
  const specPath = testInfo.outputPath("spec.json");
  await specDownload.saveAs(specPath);
  expect(readFileSync(specPath, "utf8")).not.toContain(MARK);

  const storage = await page.evaluate(() => ({ local: Object.keys(localStorage).length, session: Object.keys(sessionStorage).length }));
  expect(storage).toEqual({ local: 0, session: 0 });
  const origin = new URL(page.url()).origin;
  expect(requests.filter((u) => !u.startsWith(origin) && !u.startsWith("blob:") && !u.startsWith("data:"))).toEqual([]);
});

test.describe("files that cannot be read get a clear message with no file content", () => {
  const cases: [string, RegExp][] = [
    ["damaged.xlsx", /damaged/i],
    ["legacy.xls", /old Excel file \(\.xls\)/],
    ["encrypted.xlsx", /password/i],
  ];
  for (const [file, message] of cases) {
    test(file, async ({ page }) => {
      await page.goto(APP);
      await page.locator("#file-input").setInputFiles(join(FIX, file));
      const alert = page.getByRole("alert");
      await expect(alert).toContainText(message, { timeout: 60_000 });
      const text = await alert.innerText();
      for (const leaked of ["PK", "D0CF", "Jane", "quirks"]) expect(text).not.toContain(leaked);
      await expect(page.getByRole("heading", { name: "Choose a sheet" })).toHaveCount(0);
    });
  }
});
