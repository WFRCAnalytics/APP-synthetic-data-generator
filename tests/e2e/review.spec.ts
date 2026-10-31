// Review in a real browser, against the real workers and DuckDB: each change is applied by the
// profile worker or the generator, and its effect shows in the spec and the downloaded file.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { parseCsv } from "../helpers/csvParse";

const HERE = dirname(fileURLToPath(import.meta.url));
const ZOO = join(HERE, "../fixtures/zoo");
const APP = "/APP-synthetic-data-generator/";

const card = (page: Page, name: string) => page.locator(`[data-column="${name}"]`);

async function toReview(page: Page) {
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles(join(ZOO, "zoo_small.csv"));
  await page.getByRole("button", { name: /profile this file/i }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 120_000 });
}

async function openSettings(page: Page, name: string) {
  await card(page, name).getByText("Settings", { exact: true }).click();
  return card(page, name);
}

/** Generates, downloads the fake file and the spec, and returns both. */
async function generate(page: Page) {
  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await page.getByRole("region", { name: "Generate the fake table" }).getByRole("button", { name: /^Generate( again)?$/ }).click();
  await expect(page.getByText(/checks (passed|did not pass)/)).toBeVisible({ timeout: 120_000 });
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download zoo_small_fake\.csv/ }).click()]);
  const [specFile] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download spec/ }).click()]);
  return {
    fake: readFileSync(await csv.path(), "utf8"),
    spec: JSON.parse(readFileSync(await specFile.path(), "utf8")) as { columns: Record<string, unknown>[] },
  };
}
const specColumn = (spec: { columns: Record<string, unknown>[] }, name: string) => spec.columns.find((c) => c.name === name) as Record<string, unknown>;

test("opens a card's settings with the keyboard", async ({ page }) => {
  await toReview(page);
  await card(page, "cat_str_5").getByText("Settings", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(card(page, "cat_str_5").getByLabel("Type")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(card(page, "cat_str_5").getByLabel("Type")).toHaveCount(0);
});

test("confirming sentinel codes re-profiles the column and changes the spec", async ({ page }) => {
  await toReview(page);
  await expect(card(page, "int_sentinels")).toContainText("Codes kept: -9");
  const c = await openSettings(page, "int_sentinels");
  const box = c.getByLabel("Sentinel codes");
  await box.fill("-9");
  await c.getByLabel("Sentinel codes").locator("xpath=ancestor::form").getByRole("button", { name: "Apply" }).click();
  // 998, 999 and -1 are now ordinary values, so the range widens and only -9 is a code.
  await expect(card(page, "int_sentinels")).toContainText("Codes kept: -9 (");
  await expect(card(page, "int_sentinels")).not.toContainText("998");
  const { spec } = await generate(page);
  expect(Object.keys(specColumn(spec, "int_sentinels").sentinels as object)).toEqual(["-9"]);
});

test("choosing a type applies it and the spec reflects it", async ({ page }) => {
  await toReview(page);
  const c = await openSettings(page, "cat_int_codes");
  await c.getByLabel("Type").selectOption("integer");
  await expect(card(page, "cat_int_codes").locator(".badge").first()).toHaveText("Integer");
  await expect(card(page, "cat_int_codes")).toContainText("Detected as categorical");
  const { spec } = await generate(page);
  expect(specColumn(spec, "cat_int_codes").type).toBe("integer");
});

test("a value type the data cannot be shows a clear note and keeps the detected type", async ({ page }) => {
  await toReview(page);
  const c = await openSettings(page, "cat_str_5");
  await c.getByLabel("Type").selectOption("integer");
  await expect(card(page, "cat_str_5")).toContainText("does not fit this column");
  await expect(card(page, "cat_str_5").locator(".badge").first()).toHaveText("Categorical");
});

test("a date pattern is counted live, and one that misses values leaves the column out", async ({ page }) => {
  await toReview(page);
  const c = await openSettings(page, "date_us");
  const box = c.getByLabel("Date or time pattern");
  await box.fill("%d/%m/%Y");
  await expect(c.getByTestId("date-pattern-status")).toContainText(/Parses [\d,]+ of 2,000 values/, { timeout: 10_000 });
  await expect(c.getByTestId("date-pattern-status")).toContainText("leave this column out");
  await box.fill("%m/%d/%Y");
  await expect(c.getByTestId("date-pattern-status")).toContainText("Parses all 2,000 values.", { timeout: 10_000 });

  // A pattern that fits is accepted; one that does not turns the column unsupported.
  const d = await openSettings(page, "date_mixed_formats");
  await d.getByLabel("Date or time pattern").fill("%Y-%m-%d");
  await d.getByRole("button", { name: "Use this pattern" }).click();
  await expect(card(page, "date_mixed_formats").locator(".badge").first()).toHaveText("Unsupported in this version", { timeout: 20_000 });
  await expect(card(page, "date_mixed_formats")).toContainText("Left out");
});

test("a column left out is not in the fake file, and a renamed one has its new name", async ({ page }) => {
  await toReview(page);
  const a = await openSettings(page, "bool_tf");
  await a.getByLabel("In the fake file").selectOption("drop");
  const b = await openSettings(page, "cat_str_5");
  const name = b.getByLabel("New column name");
  await name.fill("region");
  await b.getByRole("button", { name: "Rename" }).click();
  await expect(card(page, "cat_str_5")).toContainText("Written as region");

  const { fake } = await generate(page);
  const header = fake.split("\n")[0].split(",");
  expect(header).not.toContain("bool_tf");
  expect(header).toContain("region");
  expect(header).not.toContain("cat_str_5");
});

test("neutral label codes and rare-category merging change the written labels", async ({ page }) => {
  await toReview(page);
  const c = await openSettings(page, "cat_str_5");
  await c.getByLabel(/Replace labels with neutral codes/).check();
  const { fake } = await generate(page);
  // Some columns hold line breaks inside quoted fields, so split with a real CSV parser.
  const { rows: all } = parseCsv(fake);
  const header = all[0];
  const values = new Set(all.slice(1).map((r) => r[header.indexOf("cat_str_5")]).filter(Boolean));
  expect(values.size).toBe(5);
  expect([...values].every((v) => /^cat_0[1-5]$/.test(v))).toBe(true);
  for (const real of ["North", "South", "East", "West", "Central"]) expect(fake).not.toContain(real);
});

test("the mean and spread can be restored exactly, and the spec says so", async ({ page }) => {
  await toReview(page);
  const c = await openSettings(page, "float_lognormal");
  await c.getByLabel(/Restore the exact mean and spread/).check();
  const { spec } = await generate(page);
  expect(specColumn(spec, "float_lognormal").rescale).toBe(true);
  await expect(page.getByText(/checks passed\./)).toBeVisible();
});

test("a new categorical limit profiles again and keeps the user's other changes", async ({ page }) => {
  await toReview(page);
  const a = await openSettings(page, "bool_tf");
  await a.getByLabel("In the fake file").selectOption("drop");
  await expect(card(page, "cat_int_50").locator(".badge").first()).toHaveText("Categorical");

  const region = page.getByRole("region", { name: "Review columns" });
  await region.getByLabel(/up to this many distinct values/).fill("20");
  await region.getByRole("button", { name: "Profile again" }).click();
  await expect(page.getByText("Profiling the columns again")).toBeVisible();
  await expect(page.getByText("Profiling the columns again")).toHaveCount(0, { timeout: 120_000 });

  await expect(card(page, "cat_int_50").locator(".badge").first()).toHaveText("Integer"); // 50 distinct values is now above the limit
  await expect(card(page, "bool_tf")).toContainText("Left out"); // the earlier change survived
});

test("the spec notice is on the screen and the optional protections start off", async ({ page }) => {
  await toReview(page);
  await expect(page.getByRole("note", { name: "What the spec contains" })).toContainText("real category labels");
  const c = await openSettings(page, "cat_str_5");
  await expect(c.getByLabel(/Merge categories with fewer than/)).toHaveValue("");
  await expect(c.getByLabel(/Replace labels with neutral codes/)).not.toBeChecked();
});

test("search and filters work on the real 82-column table", async ({ page }) => {
  await toReview(page);
  await expect(page.locator(".column-card")).toHaveCount(82);
  await page.getByLabel("Search columns").fill("na_");
  await expect(page.locator(".column-card")).toHaveCount(6);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Needs attention only").check();
  const attention = await page.locator(".column-card").count();
  expect(attention).toBeGreaterThan(20);
  expect(attention).toBeLessThan(82);
  await expect(page.locator(".attention-banner")).toContainText(`${attention} columns need a look`);
});

test("no real value appears in the settings panels", async ({ page }) => {
  await toReview(page);
  const raw = readFileSync(join(ZOO, "zoo_small.csv"), "utf8").split("\n");
  const header = raw[0].split(",");
  const personal = ["person_name", "email", "street_address", "phone_us", "free_text"];
  const secrets = new Set<string>();
  for (const col of personal) for (const row of raw.slice(1, 300)) secrets.add(row.split(",")[header.indexOf(col)] ?? "");

  for (const name of ["email", "person_name", "cat_str_5", "int_sentinels"]) await openSettings(page, name);
  const html = await page.content();
  expect([...secrets].filter((v) => v.length >= 8 && html.includes(v))).toEqual([]);
});
