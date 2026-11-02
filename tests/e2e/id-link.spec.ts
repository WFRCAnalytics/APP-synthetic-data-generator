// Two tables whose ID columns match (specs/019), in a real browser: the first table is made and its spec saved; the second
// table uses that spec's ID column; every ID of the second fake table exists in the first, and the spec holds no ID.
import { readFileSync } from "node:fs";
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
