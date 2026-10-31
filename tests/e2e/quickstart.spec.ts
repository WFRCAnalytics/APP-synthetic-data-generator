// Quickstart scenarios C and D in a real browser (specs/001-csv-synthetic-slice/quickstart.md). The
// other scenarios are covered by flow.spec (A), review.spec (B), privacy.spec (E), scale.spec (F)
// and tests/integration/verify-script.test.ts (G).
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { parseCsv } from "../helpers/csvParse";

const HERE = dirname(fileURLToPath(import.meta.url));
const ZOO = join(HERE, "../fixtures/zoo");
const APP = "/APP-synthetic-data-generator/";

const region = (page: Page) => page.getByRole("region", { name: "Generate the fake table" });

async function profile(page: Page, file: string) {
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles(join(ZOO, file));
  await page.getByRole("button", { name: /profile this file/i }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 180_000 });
}

async function generate(page: Page) {
  await region(page).getByRole("button", { name: /^Generate( again)?$/ }).click();
  await expect(page.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText(/All \d+ checks passed\./)).toBeVisible();
}

async function downloadText(page: Page, name: RegExp): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name }).click()]);
  return readFileSync(await download.path(), "utf8");
}

test("scenario C: ID patterns - a live sample, a narrow pattern blocks Generate, the spec holds no IDs", async ({ page }) => {
  await profile(page, "ids_50k.csv");
  const ids = new Set(
    readFileSync(join(ZOO, "ids_50k.csv"), "utf8")
      .split("\n")
      .slice(1)
      .map((l) => l.split(",")[0])
      .filter(Boolean),
  );

  const card = page.locator('[data-column="hh_id"]');
  await card.getByText("Settings", { exact: true }).click();
  const editor = card.getByRole("group", { name: "ID pattern" });
  await expect(editor.getByTestId("id-sample-hh_id")).toContainText("Examples (invented):");
  await expect(editor.getByTestId("id-fit-hh_id")).toContainText("allows");

  // A mask that is too narrow: one fewer digit and a low top number.
  await editor.getByRole("button", { name: "Remove position 1" }).click();
  await editor.getByLabel("Highest number").fill("10099");
  await expect(editor.getByRole("alert")).toContainText(/allows \d[\d,]* distinct IDs but the column needs [\d,]+/);
  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await expect(region(page).getByRole("button", { name: "Generate", exact: true })).toBeDisabled();

  // Back to the detected pattern: Generate works again, and the saved spec holds no ID.
  await page.getByRole("button", { name: /Review/ }).first().click();
  await card.getByText("Settings", { exact: true }).click(); // the card is built again, closed
  await card.getByRole("button", { name: "Reset to detected" }).click();
  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await generate(page);

  const specText = await downloadText(page, /Download spec/);
  expect(specText.length).toBeLessThan(1_000_000);
  const spec = JSON.parse(specText);
  const strings: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(spec);
  expect(strings.filter((s) => ids.has(s))).toEqual([]);
  expect(spec.columns.find((c: { name: string }) => c.name === "hh_id").mask).toHaveLength(5);
});

test("scenario D: reproducibility - same seed, byte-identical; one change affects one column", async ({ page }) => {
  await profile(page, "zoo_small.csv");
  const specPath = test.info().outputPath("spec.json");

  // Save the spec from Review, then reload the page and load it back.
  const [saved] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save spec (JSON)" }).click()]);
  await saved.saveAs(specPath);

  await page.reload();
  await page.getByLabel("Load existing spec").setInputFiles(specPath);
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible();
  await expect(page.getByText(/Loaded from a saved spec/)).toBeVisible();

  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await expect(region(page).getByTestId("spec-only-banner")).toBeVisible();
  await generate(page);
  const first = await downloadText(page, /Download .*_fake\.csv/);
  await generate(page);
  const second = await downloadText(page, /Download .*_fake\.csv/);
  expect(second).toBe(first);

  // Change one column's numeric mode, and generate again.
  await page.getByRole("button", { name: /Review/ }).first().click();
  const card = page.locator('[data-column="float_2dp"]');
  await card.getByText("Settings", { exact: true }).click();
  await card.getByLabel(/Numeric mode|Mode/).selectOption("uniform");
  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await generate(page);
  const changed = await downloadText(page, /Download .*_fake\.csv/);

  // A real CSV parser: some columns hold commas and line breaks inside quoted labels.
  const a = parseCsv(first).rows;
  const b = parseCsv(changed).rows;
  const header = a[0];
  expect(b[0]).toEqual(header);
  const differing = header.filter((_, c) => a.slice(1).some((r, i) => r[c] !== b[i + 1]?.[c]));
  expect(differing).toEqual(["float_2dp"]);
  expect(statSync(specPath).size).toBeLessThan(1_000_000);
});

// ---- Slice 2 (specs/002-personal-text-columns/quickstart.md) ----------------------------------

test("slice 2 scenario A: names, emails, phones and addresses keep their counts and none is real", async ({ page }) => {
  await profile(page, "text_50k.csv");
  const real = parseCsv(readFileSync(join(ZOO, "text_50k.csv"), "utf8")).rows;
  const realHeader = real[0];
  const col = (rows: string[][], header: string[], name: string) => rows.slice(1).map((r) => r[header.indexOf(name)]);

  await expect(page.locator('[data-column="respondent_name"]')).toContainText("Personal identifier");
  await expect(page.locator('[data-column="email"]')).toContainText("Invented email addresses");
  await expect(page.locator('[data-column="plate"]')).toContainText("Short string");

  // A live sample of invented values, and a change of kind updates it.
  const card = page.locator('[data-column="respondent_name"]');
  await card.getByText("Settings", { exact: true }).click();
  await expect(card.getByTestId("sample-respondent_name")).toContainText("Examples (invented)", { timeout: 30_000 });
  const before = await card.getByTestId("sample-respondent_name").innerText();
  await card.getByLabel("Kind").selectOption("last_name");
  await expect(card.getByTestId("sample-respondent_name")).not.toHaveText(before, { timeout: 30_000 });
  await card.getByLabel("Kind").selectOption("full_name");

  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await generate(page);
  const fake = parseCsv(await downloadText(page, /Download .*_fake\.csv/)).rows;
  const fakeHeader = fake[0];
  expect(fakeHeader).toEqual(realHeader);
  expect(fake.length).toBe(real.length);

  for (const name of ["respondent_name", "email", "phone", "address"]) {
    const a = col(real, realHeader, name);
    const b = col(fake, fakeHeader, name);
    const distinct = (v: string[]) => new Set(v.filter((x) => x !== "" && x !== "NA")).size;
    expect(distinct(b), `${name} distinct`).toBe(distinct(a));
    expect(b.filter((x) => x === "" || x === "NA").length, `${name} missing`).toBe(a.filter((x) => x === "" || x === "NA").length);
    const realSet = new Set(a);
    expect(b.filter((x) => x !== "" && x !== "NA" && realSet.has(x)), `${name} real values written`).toEqual([]);
  }
});

test("slice 2 scenario E: an SSN-style column is left out until it is acknowledged, then generated in the 900 range", async ({ page }) => {
  await profile(page, "zoo_small.csv");
  const ssn = page.locator('[data-column="ssn_like"]');
  await expect(ssn).toContainText("Left out");
  await ssn.getByText("Settings", { exact: true }).click();
  await ssn.getByLabel(/I understand that invented social-security-style numbers/).check();
  await expect(ssn).not.toContainText("Left out");

  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await generate(page);
  const rows = parseCsv(await downloadText(page, /Download .*_fake\.csv/)).rows;
  const idx = rows[0].indexOf("ssn_like");
  expect(idx).toBeGreaterThan(-1);
  const values = rows.slice(1).map((r) => r[idx]).filter((v) => v !== "");
  expect(values.length).toBeGreaterThan(1000);
  for (const v of values) expect(v).toMatch(/^9\d\d-\d\d-\d{4}$/);

  // Cleared again, the column goes back to being left out.
  await page.getByRole("button", { name: /Review/ }).first().click();
  await ssn.getByText("Settings", { exact: true }).click();
  await ssn.getByLabel(/I understand that invented social-security-style numbers/).uncheck();
  await expect(ssn).toContainText("Left out");
});

test("slice 2 scenario F: a slice 1 spec loads, and its unsupported column needs the file to change", async ({ page }) => {
  await page.goto(APP);
  await page.getByLabel("Load existing spec").setInputFiles(join(HERE, "../fixtures/spec-v1.json"));
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible();
  const email = page.locator('[data-column="respondent_email"]');
  await expect(email).toContainText("Left out");
  await email.getByText("Settings", { exact: true }).click();
  await expect(email.getByLabel("Type")).toBeDisabled();
  await expect(email.getByTestId("needs-source-file")).toContainText("Open the original file");

  // The columns it can generate still do.
  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await generate(page);
  const rows = parseCsv(await downloadText(page, /Download .*_fake\.csv/)).rows;
  expect(rows[0]).toEqual(["mode", "hh_id"]);
  expect(rows.length - 1).toBe(200);
});
