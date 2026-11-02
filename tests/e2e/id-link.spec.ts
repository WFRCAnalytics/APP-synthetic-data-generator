// Two tables whose ID columns match (specs/019), in a real browser: the first table is made and its spec saved; the second
// table uses that spec's ID column; every ID of the second fake table exists in the first, and the spec holds no ID.
import { readFileSync } from "node:fs";
import { readEntryText, readZipDirectory } from "../../src/lib/xlsx/zip";
import { expect, test, type Page } from "@playwright/test";
import { shownCard } from "../helpers/review";

const APP = "/APP-synthetic-data-generator/";
const region = (page: Page) => page.getByRole("region", { name: "Generate the fake table" });

const households = ["hh_id,size,members"].concat(Array.from({ length: 300 }, (_, i) => `H${1000 + i},${1 + (i % 5)},${5 + ((i * 37) % 900)}`)).join("\n") + "\n";
// Households have between one and four people each; 120 of the 300 households appear.
const persons =
  ["hh_id,age"]
    .concat(
      Array.from({ length: 120 }, (_, h) => Array.from({ length: 1 + (h % 4) }, (_, k) => `H${1000 + h},${20 + ((h * 7 + k * 13) % 60)}`)).flat(),
    )
    .join("\n") + "\n";

async function makeTable(page: Page, name: string, csv: string) {
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: /profile this file/i }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 120_000 });
}

async function generate(page: Page, fakeName: RegExp) {
  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await page.getByLabel("Seed").fill("7");
  await region(page).getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({ timeout: 120_000 });
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: fakeName }).click()]);
  const [spec] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download spec (JSON)" }).click()]);
  return { csv: readFileSync(await csv.path(), "utf8"), specPath: await spec.path() };
}

const column = (csv: string, index: number) =>
  csv
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(",")[index]);

test("a second table uses the IDs of the first, so every row joins", async ({ page }, testInfo) => {
  await makeTable(page, "households.csv", households);
  const first = await generate(page, /Download households_fake\.csv/);
  const parentIds = new Set(column(first.csv, 0));
  expect(parentIds.size).toBe(300);

  await makeTable(page, "persons.csv", persons);
  const card = await shownCard(page, "hh_id");
  await card.getByLabel("Spec of the other table").setInputFiles(first.specPath);
  await card.getByRole("button", { name: "Use these IDs" }).click();
  await expect(card.getByTestId("id-link-summary")).toContainText("households.csv");

  const second = await generate(page, /Download persons_fake\.csv/);
  const childIds = column(second.csv, 0);
  expect(childIds.length).toBe(300);
  expect(childIds.every((id) => parentIds.has(id))).toBe(true);
  expect(new Set(childIds).size).toBe(120); // the table's own repeat structure is kept

  // The saved spec of the second table names the link and holds no ID.
  const spec = readFileSync(second.specPath, "utf8");
  expect(JSON.parse(spec).columns[0].link.column).toBe("hh_id");
  for (const id of parentIds) expect(spec).not.toContain(`"${id}"`);
  testInfo.annotations.push({ type: "ids", description: `${parentIds.size} parent IDs, ${new Set(childIds).size} used` });
});

test("a household's size follows the rows the persons table has for it", async ({ page }) => {
  await makeTable(page, "households.csv", households);
  const first = await generate(page, /Download households_fake\.csv/);
  await makeTable(page, "persons.csv", persons);
  const personCard = await shownCard(page, "hh_id");
  await personCard.getByLabel("Spec of the other table").setInputFiles(first.specPath);
  await personCard.getByRole("button", { name: "Use these IDs" }).click();
  const second = await generate(page, /Download persons_fake\.csv/);

  // Back to the households: the members column now counts the persons rows.
  await makeTable(page, "households.csv", households);
  const members = await shownCard(page, "members");
  await members.getByLabel("Spec of the other table").setInputFiles(second.specPath);
  await members.getByRole("button", { name: "Count its rows" }).click();
  await expect(members.getByTestId("child-count-summary")).toContainText("persons.csv");
  const again = await generate(page, /Download households_fake\.csv/);
  await expect(page.getByText(/rows of the other table/)).toBeVisible();

  const counts = new Map<string, number>();
  for (const id of column(second.csv, 0)) counts.set(id, (counts.get(id) ?? 0) + 1);
  const rows = again.csv.trim().split(String.fromCharCode(10)).slice(1).map((line) => line.split(","));
  expect(rows.length).toBe(300);
  for (const [id, , membersText] of rows) expect(Number(membersText)).toBe(counts.get(id) ?? 0);
  expect(rows.reduce((n, r) => n + Number(r[2]), 0)).toBe(column(second.csv, 0).length);
});

test("a designed table can use the IDs of a table made from a file", async ({ page }) => {
  await makeTable(page, "households.csv", households);
  const first = await generate(page, /Download households_fake\.csv/);
  const parentIds = new Set(column(first.csv, 0));

  await page.goto(APP);
  await page.getByRole("button", { name: "Design a table" }).click();
  await page.getByRole("button", { name: /Table settings/ }).click();
  await page.getByLabel("Table name").fill("persons");
  await page.getByLabel("Number of rows").fill("500");
  await page.getByRole("button", { name: "Add column" }).click();
  await page.getByRole("button", { name: /^ID/ }).click();
  await page.getByLabel("Column name").fill("hh_id");
  await page.getByLabel("Spec of the other table").setInputFiles(first.specPath);
  await page.getByRole("button", { name: "Use these IDs" }).click();
  await expect(page.getByTestId("design-id-link-summary")).toContainText("households.csv");
  await page.getByLabel("Fewest rows per ID").fill("1");
  await page.getByLabel("Most rows per ID").fill("4");

  await page.getByRole("button", { name: "Continue to Review" }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible();
  const second = await generate(page, /Download persons_fake\.csv/);
  const ids = column(second.csv, 0);
  expect(ids.length).toBe(500);
  expect(ids.every((id) => parentIds.has(id))).toBe(true);
  const sizes = new Map<string, number>();
  for (const id of ids) sizes.set(id, (sizes.get(id) ?? 0) + 1);
  expect(Math.min(...sizes.values())).toBeGreaterThanOrEqual(1);
  expect(Math.max(...sizes.values())).toBeLessThanOrEqual(4);
});

test("several tables are made together from their specs, and the zip joins", async ({ page }) => {
  await makeTable(page, "households.csv", households);
  const first = await generate(page, /Download households_fake\.csv/);
  await makeTable(page, "persons.csv", persons);
  const card = await shownCard(page, "hh_id");
  await card.getByLabel("Spec of the other table").setInputFiles(first.specPath);
  await card.getByRole("button", { name: "Use these IDs" }).click();
  const second = await generate(page, /Download persons_fake\.csv/);

  await page.goto(APP);
  const panel = page.getByTestId("batch-panel");
  await panel.getByLabel("Specs of the tables").setInputFiles([second.specPath, first.specPath]);
  await expect(panel.getByTestId("batch-table")).toContainText("persons_fake.csv");
  await expect(panel.getByTestId("batch-warning")).toHaveCount(0); // the two tables fit together
  await panel.getByRole("button", { name: "Make all tables" }).click();
  await expect(panel.getByText(/Done, \d+ checks passed/)).toHaveCount(2, { timeout: 120_000 });

  const [zip] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Download all (zip)" }).click()]);
  expect(zip.suggestedFilename()).toBe("tables.zip");
  const bytes = readFileSync(await zip.path());
  const blob = new Blob([bytes as BlobPart]);
  const entries = await readZipDirectory(blob);
  const names = entries.map((e) => e.name).sort();
  expect(names).toEqual([
    "households_fake/households_fake.csv",
    "households_fake/households_fake_README.md",
    "households_fake/households_spec.json",
    "persons_fake/persons_fake.csv",
    "persons_fake/persons_fake_README.md",
    "persons_fake/persons_spec.json",
  ]);
  const read = (name: string) => readEntryText(blob, entries.find((e) => e.name === name)!);
  const parentIds = new Set(column(await read("households_fake/households_fake.csv"), 0));
  const childIds = column(await read("persons_fake/persons_fake.csv"), 0);
  expect(childIds.length).toBe(300);
  expect(childIds.every((id) => parentIds.has(id))).toBe(true);
  // The same tables as when each is made on its own screen.
  expect(await read("households_fake/households_fake.csv")).toBe(first.csv);
  expect(await read("persons_fake/persons_fake.csv")).toBe(second.csv);
});

test("a set of tables can be written as another file type", async ({ page }) => {
  await makeTable(page, "households.csv", households);
  const first = await generate(page, /Download households_fake\.csv/);
  await makeTable(page, "persons.csv", persons);
  const card = await shownCard(page, "hh_id");
  await card.getByLabel("Spec of the other table").setInputFiles(first.specPath);
  await card.getByRole("button", { name: "Use these IDs" }).click();
  const second = await generate(page, /Download persons_fake\.csv/);

  await page.goto(APP);
  const panel = page.getByTestId("batch-panel");
  await panel.getByLabel("Specs of the tables").setInputFiles([first.specPath, second.specPath]);
  await panel.getByLabel("File type").selectOption("sav");
  await expect(panel.getByTestId("batch-table")).toContainText("persons_fake.sav");
  await panel.getByRole("button", { name: "Make all tables" }).click();
  await expect(panel.getByText(/Done, \d+ checks passed/)).toHaveCount(2, { timeout: 120_000 });
  const [zip] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Download all (zip)" }).click()]);
  const blob = new Blob([readFileSync(await zip.path()) as BlobPart]);
  const entries = await readZipDirectory(blob);
  expect(entries.map((e) => e.name).sort()).toEqual([
    "households_fake/households_fake.sav",
    "households_fake/households_fake_README.md",
    "households_fake/households_spec.json",
    "persons_fake/persons_fake.sav",
    "persons_fake/persons_fake_README.md",
    "persons_fake/persons_spec.json",
  ]);
  const sav = await readEntryText(blob, entries.find((e) => e.name === "persons_fake/persons_fake.sav")!);
  expect(sav.startsWith("$FL2")).toBe(true);
});
