// Review in a real browser, against the real workers and DuckDB: each change is applied by the
// profile worker or the generator, and its effect shows in the spec and the downloaded file.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { parseCsv } from "../helpers/csvParse";
import { shownCard } from "../helpers/review";

const HERE = dirname(fileURLToPath(import.meta.url));
const ZOO = join(HERE, "../fixtures/zoo");
const APP = "/APP-synthetic-data-generator/";

async function toReview(page: Page) {
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles(join(ZOO, "zoo_small.csv"));
  await page.getByRole("button", { name: /profile this file/i }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 120_000 });
}

async function openSettings(page: Page, name: string) {
  return shownCard(page, name);
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

test("moves between columns with the arrow keys, and opens one with Enter", async ({ page }) => {
  await toReview(page);
  const first = page.locator("[data-nav-column]").first();
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("[data-nav-column]").nth(1)).toBeFocused();
  await expect(page.locator("[data-nav-column]").nth(1)).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".column-card")).toHaveCount(1);
  await expect(page.locator(".column-card").getByLabel("Type")).toBeVisible();
});

test("confirming sentinel codes re-profiles the column and changes the spec", async ({ page }) => {
  await toReview(page);
  await expect((await shownCard(page, "int_sentinels"))).toContainText("Codes kept: -9");
  const c = await openSettings(page, "int_sentinels");
  const box = c.getByLabel("Sentinel codes");
  await box.fill("-9");
  await c.getByLabel("Sentinel codes").locator("xpath=ancestor::form").getByRole("button", { name: "Apply" }).click();
  // 998, 999 and -1 are now ordinary values, so the range widens and only -9 is a code.
  await expect((await shownCard(page, "int_sentinels"))).toContainText("Codes kept: -9 (");
  await expect((await shownCard(page, "int_sentinels"))).not.toContainText("998");
  const { spec } = await generate(page);
  expect(Object.keys(specColumn(spec, "int_sentinels").sentinels as object)).toEqual(["-9"]);
});

test("choosing a type applies it and the spec reflects it", async ({ page }) => {
  await toReview(page);
  const c = await openSettings(page, "cat_int_codes");
  await c.getByLabel("Type").selectOption("integer");
  await expect((await shownCard(page, "cat_int_codes")).locator(".badge").first()).toHaveText("Integer");
  await expect((await shownCard(page, "cat_int_codes"))).toContainText("Detected as categorical");
  const { spec } = await generate(page);
  expect(specColumn(spec, "cat_int_codes").type).toBe("integer");
});

test("a value type the data cannot be shows a clear note and keeps the detected type", async ({ page }) => {
  await toReview(page);
  const c = await openSettings(page, "cat_str_5");
  await c.getByLabel("Type").selectOption("integer");
  await expect((await shownCard(page, "cat_str_5"))).toContainText("does not fit this column");
  await expect((await shownCard(page, "cat_str_5")).locator(".badge").first()).toHaveText("Categorical");
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
  await expect((await shownCard(page, "date_mixed_formats")).locator(".badge").first()).toHaveText("Unsupported in this version", { timeout: 20_000 });
  await expect((await shownCard(page, "date_mixed_formats"))).toContainText("Left out");
});

test("a column left out is not in the fake file, and a renamed one has its new name", async ({ page }) => {
  await toReview(page);
  const a = await openSettings(page, "bool_tf");
  await a.getByLabel("In the fake file").selectOption("drop");
  const b = await openSettings(page, "cat_str_5");
  const name = b.getByLabel("New column name");
  await name.fill("region");
  await b.getByRole("button", { name: "Rename" }).click();
  await expect((await shownCard(page, "cat_str_5"))).toContainText("Written as region");

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
  // (The other columns hold invented street names and words, so the whole file is not searched for "North".)
  for (const real of ["North", "South", "East", "West", "Central"]) expect(values.has(real)).toBe(false);
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
  await expect((await shownCard(page, "cat_int_50")).locator(".badge").first()).toHaveText("Categorical");

  await page.getByRole("button", { name: "Overview" }).click(); // the limit lives in the overview
  const region = page.getByRole("region", { name: "Review columns" });
  await region.getByLabel(/up to this many distinct values/).fill("20");
  await region.getByRole("button", { name: "Profile again" }).click();
  await expect(page.getByText("Profiling the columns again")).toBeVisible();
  await expect(page.getByText("Profiling the columns again")).toHaveCount(0, { timeout: 120_000 });

  await expect((await shownCard(page, "cat_int_50")).locator(".badge").first()).toHaveText("Integer"); // 50 distinct values is now above the limit
  await expect((await shownCard(page, "bool_tf"))).toContainText("Left out"); // the earlier change survived
});

test("the spec notice is on the screen and the optional protections start off", async ({ page }) => {
  await toReview(page);
  await expect(page.getByRole("note", { name: "What the spec contains" })).toContainText("real category labels");
  const c = await openSettings(page, "cat_str_5");
  await expect(c.getByLabel(/Merge categories with fewer than/)).toHaveValue("");
  await expect(c.getByLabel(/Replace labels with neutral codes/)).not.toBeChecked();
});

test("search and filters work on the real 88-column table", async ({ page }) => {
  await toReview(page);
  await expect(page.getByTestId("filter-count")).toHaveText("Showing 88 of 88 columns");
  await page.getByLabel("Search columns").fill("na_");
  await expect(page.getByTestId("filter-count")).toHaveText("Showing 6 of 88 columns");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Needs attention only").check();
  const attention = Number(/Showing (\d+) of/.exec((await page.getByTestId("filter-count").textContent()) ?? "")?.[1]);
  expect(attention).toBeGreaterThan(10);
  expect(attention).toBeLessThan(88);
  await expect(page.locator(".attention-banner")).toContainText(`${attention} columns need a look`);
});

test("no real value appears in the settings panels", async ({ page }) => {
  await toReview(page);
  const raw = readFileSync(join(ZOO, "zoo_small.csv"), "utf8").split("\n");
  const header = raw[0].split(",");
  const personal = ["person_name", "email", "street_address", "phone_us", "free_text"];
  const secrets = new Set<string>();
  for (const col of personal) for (const row of raw.slice(1, 300)) secrets.add(row.split(",")[header.indexOf(col)] ?? "");

  const leaks: string[] = [];
  for (const name of ["email", "person_name", "cat_str_5", "int_sentinels"]) {
    await openSettings(page, name);
    const html = await page.content();
    leaks.push(...[...secrets].filter((v) => v.length >= 8 && html.includes(v)));
  }
  expect(leaks).toEqual([]);
});

test("a codebook puts labels beside the codes, in the card, the spec and the README, and leaves the file's values alone", async ({ page }) => {
  await toReview(page);
  await page.getByRole("button", { name: "Overview" }).click();
  const book = JSON.stringify({ cat_str_5: { Central: "Central district", South: "South district", Nowhere: "Not in the table" }, cat_int_codes: { "3": "Three wheels", "97": "Refused" }, not_a_column: { "1": "x" } });
  await page.getByLabel("Add a codebook").setInputFiles({ name: "codebook.json", mimeType: "application/json", buffer: Buffer.from(book) });
  await expect(page.getByRole("status").filter({ hasText: "Added 4 labels to 2 columns." })).toContainText("2 entries matched nothing");

  await shownCard(page, "cat_str_5");
  await expect(page.getByLabel("Value labels of cat_str_5")).toContainText("South district");

  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await page.getByRole("region", { name: "Generate the fake table" }).getByRole("button", { name: /^Generate( again)?$/ }).click();
  await expect(page.getByText(/checks (passed|did not pass)/)).toBeVisible({ timeout: 120_000 });
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download zoo_small_fake\.csv/ }).click()]);
  expect(readFileSync(await csv.path(), "utf8")).not.toContain("Central district");
  const [spec] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download spec (JSON)" }).click()]);
  const json = JSON.parse(readFileSync(await spec.path(), "utf8"));
  expect(json.columns.find((c: { name: string }) => c.name === "cat_str_5").value_labels).toEqual({ Central: "Central district", South: "South district" });
  const [readme] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download README for agents" }).click()]);
  expect(readFileSync(await readme.path(), "utf8")).toContain("`Central` (Central district)");
});

test("a latitude and a longitude keep only their bounding box, and the person can turn that off", async ({ page }) => {
  let csv = "id,lat,lon,age\n";
  for (let i = 0; i < 400; i++) csv += `${i},${(40.5 + ((i * 37) % 680) / 1000).toFixed(5)},${(-112.2 + ((i * 53) % 700) / 1000).toFixed(5)},${18 + (i % 60)}\n`;
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles({ name: "places.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: /profile this file/i }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 120_000 });

  const card = await shownCard(page, "lat");
  await expect(card).toContainText("Only the bounding box is kept");
  await expect(card.getByLabel("Coordinate")).toHaveValue("lat");
  await expect(card.getByLabel(/The same average and spread/)).toHaveCount(0);
  await expect((await shownCard(page, "age")).getByLabel("Coordinate")).toHaveValue("");

  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await page.getByRole("region", { name: "Generate the fake table" }).getByRole("button", { name: /^Generate( again)?$/ }).click();
  await expect(page.getByText(/checks (passed|did not pass)/)).toBeVisible({ timeout: 120_000 });
  const [fake] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download places_fake\.csv/ }).click()]);
  const { rows } = parseCsv(readFileSync(await fake.path(), "utf8"));
  const lats = rows.slice(1).map((r) => Number(r[1]));
  expect(Math.min(...lats)).toBeGreaterThanOrEqual(40.5);
  expect(Math.max(...lats)).toBeLessThanOrEqual(41.18);
  const [spec] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download spec (JSON)" }).click()]);
  const json = JSON.parse(readFileSync(await spec.path(), "utf8"));
  const latSpec = json.columns.find((c: { name: string }) => c.name === "lat");
  expect(latSpec).toMatchObject({ coordinate: "lat", mode: "uniform" });
  expect(latSpec.quantiles).toBeUndefined();
  expect(latSpec.mean).toBeUndefined();
  expect(json.columns.find((c: { name: string }) => c.name === "age").quantiles).toHaveLength(101);

  // Turned off, the column is an ordinary decimal again.
  await page.getByRole("button", { name: /^1\. Ingest|Review/ }).first().click();
  const again = await shownCard(page, "lat");
  await again.getByLabel("Coordinate").selectOption("");
  await expect(again.getByLabel(/The same average and spread/)).toBeVisible();
});

test("a rule between two columns holds in every row of the file, is checked, and is kept in the spec and the README", async ({ page }) => {
  let csv = "id,start,end,age\n";
  const day = (n: number) => new Date(Date.UTC(2023, 0, 1) + n * 86400000).toISOString().slice(0, 10);
  for (let i = 0; i < 400; i++) csv += `${i},${day((i * 7) % 300)},${day(((i * 11) % 300) + 5)},${18 + (i % 60)}\n`;
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles({ name: "stays.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: /profile this file/i }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 120_000 });

  await page.getByRole("button", { name: "Overview" }).click();
  await page.getByText("Add a rule", { exact: true }).click();
  await page.getByLabel("Column that changes").selectOption("end");
  await page.getByLabel("Comes after").selectOption("start");
  await page.getByLabel("Gap from").fill("3");
  await page.getByLabel("to", { exact: true }).fill("9");
  await page.getByRole("button", { name: "Add the rule" }).click();
  await expect(page.getByRole("list", { name: "Rules" })).toContainText("end comes 3 to 9 after start");

  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await page.getByRole("region", { name: "Generate the fake table" }).getByRole("button", { name: /^Generate( again)?$/ }).click();
  await expect(page.getByText(/checks passed\./)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("cell", { name: "end comes 3 to 9 after start" }).first()).toBeVisible();
  const [fake] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download stays_fake\.csv/ }).click()]);
  const { rows } = parseCsv(readFileSync(await fake.path(), "utf8"));
  const ms = (t: string) => Date.parse(`${t}T00:00:00Z`) / 86400000;
  for (const r of rows.slice(1)) {
    const gap = ms(r[2]) - ms(r[1]);
    expect(gap).toBeGreaterThanOrEqual(3);
    expect(gap).toBeLessThanOrEqual(9);
  }
  const [spec] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download spec (JSON)" }).click()]);
  expect(JSON.parse(readFileSync(await spec.path(), "utf8")).rules).toEqual([{ kind: "follows", column: "end", after: "start", min: 3, max: 9 }]);
  const [readme] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download README for agents" }).click()]);
  expect(readFileSync(await readme.path(), "utf8")).toContain("- end comes 3 to 9 after start");
});
