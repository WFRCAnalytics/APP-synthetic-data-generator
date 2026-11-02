// Start from scratch in a real browser (specs/006): design a table, review it, generate it, and check
// the downloaded file against what was asked. Also: the saved spec loads again to the same bytes, the
// screens have no detectable accessibility problem, and nothing leaves the page.
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { parseCsv } from "../helpers/csvParse";

const APP = "/APP-synthetic-data-generator/";

async function addColumn(page: Page, kind: RegExp) {
  await page.getByRole("button", { name: "Add column" }).click();
  await page.getByRole("button", { name: kind }).click();
}

async function design(page: Page) {
  await page.goto(APP);
  await page.getByRole("button", { name: "Design a table" }).click();

  await page.getByRole("button", { name: /Table settings/ }).click();
  await page.getByLabel("Table name").fill("trips");
  await page.getByLabel("Number of rows").fill("1200");

  await addColumn(page, /Whole number/);
  await page.getByLabel("Column name").fill("age");
  await page.getByLabel("Smallest").fill("18");
  await page.getByLabel("Largest").fill("90");
  await page.getByLabel("How values are spread").selectOption("bell");
  await page.getByLabel("Typical value").fill("40");
  await page.getByLabel("Spread", { exact: true }).fill("12");
  await page.getByLabel("Missing (percent of rows)").fill("5");

  await addColumn(page, /^Category/);
  await page.getByLabel("Column name").fill("mode");
  await page.getByLabel("Labels and how common each is").fill("Bus: 50\nRail: 30\nWalk: 20");

  await addColumn(page, /^Date A day/);
  await page.getByLabel("Column name").fill("day");
  await page.getByLabel("First day").fill("2023-01-01");
  await page.getByLabel("Last day").fill("2023-03-31");

  await addColumn(page, /^ID/);
  await page.getByLabel("Column name").fill("pid");
  await page.getByLabel("Starts with").fill("P");
  await page.getByLabel("Digits").fill("5");
}

async function reviewAndGenerate(page: Page) {
  await page.getByRole("button", { name: "Continue to Review" }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await page.getByRole("region", { name: "Generate the fake table" }).getByRole("button", { name: /^Generate( again)?$/ }).click();
  await expect(page.getByText(/checks passed\./)).toBeVisible({ timeout: 60_000 });
}

const download = async (page: Page, name: RegExp) => {
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name }).click()]);
  return readFileSync(await d.path(), "utf8");
};

test("a designed table comes out as asked, and the same spec gives the same bytes in a fresh session", async ({ page, browser }) => {
  await design(page);
  await reviewAndGenerate(page);

  expect(page.url()).toContain("/APP-synthetic-data-generator/");
  const csv = await download(page, /Download trips_fake\.csv/);
  const { rows } = parseCsv(csv);
  expect(rows[0]).toEqual(["age", "mode", "day", "pid"]);
  expect(rows).toHaveLength(1201);

  const body = rows.slice(1);
  const ages = body.map((r) => r[0]).filter((v) => v !== "");
  expect(body.length - ages.length).toBe(60); // 5 percent of 1200
  expect(Math.min(...ages.map(Number))).toBeGreaterThanOrEqual(18);
  expect(Math.max(...ages.map(Number))).toBeLessThanOrEqual(90);
  expect(Math.abs(ages.reduce((a, b) => a + Number(b), 0) / ages.length - 40)).toBeLessThan(2);

  const modes = body.map((r) => r[1]);
  expect(modes.filter((m) => m === "Bus")).toHaveLength(600);
  expect(modes.filter((m) => m === "Rail")).toHaveLength(360);
  expect(modes.filter((m) => m === "Walk")).toHaveLength(240);

  for (const day of body.map((r) => r[2])) {
    expect(day).toMatch(/^2023-0[1-3]-\d\d$/);
    expect(day >= "2023-01-01" && day <= "2023-03-31").toBe(true);
  }
  expect(new Set(body.map((r) => r[3])).size).toBe(1200);
  expect(body.every((r) => /^P\d{5}$/.test(r[3]))).toBe(true);

  // Save the spec, load it in a fresh session: the same seed gives the same file.
  const specText = await download(page, /Download spec/);
  const spec = JSON.parse(specText) as { n_rows: number; columns: unknown[] };
  expect(spec.n_rows).toBe(1200);
  expect(spec.columns).toHaveLength(4);

  const fresh = await browser.newPage();
  await fresh.goto(APP);
  await fresh.getByLabel("Load existing spec").setInputFiles({ name: "trips_spec.json", mimeType: "application/json", buffer: Buffer.from(specText) });
  await expect(fresh.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 30_000 });
  await fresh.getByRole("button", { name: "Continue to Generate" }).click();
  await fresh.getByRole("region", { name: "Generate the fake table" }).getByRole("button", { name: /^Generate( again)?$/ }).click();
  await expect(fresh.getByText(/checks passed\./)).toBeVisible({ timeout: 60_000 });
  expect(await download(fresh, /Download trips_fake\.csv/)).toBe(csv);
  await fresh.close();
});

test("Design has no detectable accessibility problems, and an error is announced next to its field", async ({ page }) => {
  await design(page);
  const run = async () => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(await run(), "a column form").toEqual([]);

  await page.getByRole("button", { name: /Table settings/ }).click();
  expect(await run(), "table settings").toEqual([]);

  await page.getByRole("button", { name: "Add column" }).click();
  expect(await run(), "the kind picker").toEqual([]);

  await page.locator('[data-design-column="age"]').click();
  await page.getByLabel("Largest").fill("10");
  await expect(page.getByText(/The largest value must be more than the smallest/)).toBeVisible();
  await expect(page.getByLabel("Largest")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "Continue to Review" })).toBeDisabled();
  expect(await run(), "a column with a problem").toEqual([]);
});

test("a designed table never sends anything or stores anything", async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await design(page);
  await reviewAndGenerate(page);
  const origin = new URL(page.url()).origin;
  expect(requests.filter((u) => !u.startsWith(origin) && !u.startsWith("blob:") && !u.startsWith("data:"))).toEqual([]);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  expect(errors).toEqual([]);
});

// Slice 9: the same designed table, written as each other file type.
const downloadBytes = async (page: Page, name: RegExp) => {
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name }).click()]);
  return readFileSync(await d.path());
};

async function chooseFileType(page: Page, value: string) {
  // Table settings is open from design(); the select keeps the choice while columns are added.
  await page.getByRole("button", { name: /Table settings/ }).click();
  await page.getByLabel("File type").selectOption(value);
}

test("a designed table is written as JSON, with numbers, text and nulls as designed", async ({ page }) => {
  await design(page);
  await chooseFileType(page, "json");
  await reviewAndGenerate(page);
  await expect(page.getByTestId("json-layout")).toContainText("a list of records, indented by 2 spaces");
  const records = JSON.parse((await downloadBytes(page, /Download trips_fake\.json/)).toString("utf8")) as Record<string, unknown>[];
  expect(records).toHaveLength(1200);
  expect(Object.keys(records[0])).toEqual(["age", "mode", "day", "pid"]);
  expect(records.filter((r) => r.age === null)).toHaveLength(60);
  for (const r of records) if (r.age !== null) expect(typeof r.age).toBe("number");
  for (const r of records) expect(r.day).toMatch(/^2023-\d{2}-\d{2}$/);
});

test("a designed table is written as JSON Lines, one record per line", async ({ page }) => {
  await design(page);
  await chooseFileType(page, "ndjson");
  await reviewAndGenerate(page);
  const text = (await downloadBytes(page, /Download trips_fake\.ndjson/)).toString("utf8");
  const lines = text.split("\n").filter((l) => l.length > 0);
  expect(lines).toHaveLength(1200);
  expect(Object.keys(JSON.parse(lines[0]))).toEqual(["age", "mode", "day", "pid"]);
});

test("a designed table is written as Parquet and as a workbook, and the Parquet spec loads again", async ({ page, browser }) => {
  await design(page);
  await chooseFileType(page, "parquet");
  await reviewAndGenerate(page);
  const parquet = await downloadBytes(page, /Download trips_fake\.parquet/);
  expect(parquet.subarray(0, 4).toString("latin1")).toBe("PAR1");
  expect(parquet.subarray(parquet.length - 4).toString("latin1")).toBe("PAR1");
  const spec = await downloadBytes(page, /Download spec \(JSON\)/);
  expect(JSON.parse(spec.toString("utf8")).source).toMatchObject({ format: "parquet", file_name: "trips.parquet" });

  const fresh = await (await browser.newContext({ acceptDownloads: true })).newPage();
  await fresh.goto(APP);
  await fresh.getByLabel("Load existing spec").setInputFiles({ name: "trips_spec.json", mimeType: "application/json", buffer: spec });
  await expect(fresh.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 30_000 });
  await fresh.getByRole("button", { name: "Continue to Generate" }).click();
  await fresh.getByRole("region", { name: "Generate the fake table" }).getByRole("button", { name: /^Generate( again)?$/ }).click();
  await expect(fresh.getByText(/checks passed\./)).toBeVisible({ timeout: 60_000 });
  const again = await downloadBytes(fresh, /Download trips_fake\.parquet/);
  expect(again.equals(parquet)).toBe(true);

  await page.goto(APP);
  await design(page);
  await chooseFileType(page, "xlsx");
  await reviewAndGenerate(page);
  const book = await downloadBytes(page, /Download trips_fake\.xlsx/);
  expect(book.subarray(0, 2).toString("latin1")).toBe("PK");
});

// Slice 14: names invented in another language and region.
test("a designed personal column can come from another region, and the README says so", async ({ page }) => {
  await page.goto(APP);
  await page.getByRole("button", { name: "Design a table" }).click();
  await page.getByRole("button", { name: /Table settings/ }).click();
  await page.getByLabel("Number of rows").fill("600");
  await addColumn(page, /^Personal detail/);
  await page.getByLabel("Column name").fill("nombre");
  await page.getByLabel("Language and region").selectOption("es");
  await reviewAndGenerate(page);
  const csv = await download(page, /Download my_table_fake\.csv/);
  const names = parseCsv(csv).rows.slice(1).map((r) => r[0]);
  expect(names).toHaveLength(600);
  expect(names.join(" ")).toMatch(/[ñáéíóúÑÁÉÍÓÚ]/);
  const [readme] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download README for agents" }).click()]);
  expect(readFileSync(await readme.path(), "utf8")).toContain("invented full name (Spanish, Spain)");
});
