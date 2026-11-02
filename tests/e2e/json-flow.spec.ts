// JSON in a real browser under the strict content policy (specs/007 FR-001 to FR-009, FR-012, FR-014): a file goes
// in, only its structure is shown, it is profiled like a CSV, a fake file comes out in the same form, and that file
// is read back with an independent parser and compared with the real one. The JSON reader is served by the site.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { shownCard } from "../helpers/review";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../fixtures/json");
const APP = "/APP-synthetic-data-generator/";
const region = (page: Page) => page.getByRole("region", { name: "Generate the fake table" });

async function chooseJson(page: Page, name: string) {
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles(join(FIX, name));
  await expect(page.getByTestId("json-summary")).toBeVisible({ timeout: 60_000 });
}

async function review(page: Page) {
  await page.getByRole("button", { name: "Profile this file" }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 180_000 });
}

async function generateAndDownload(page: Page, filename: RegExp, seed = "42") {
  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await page.getByLabel("Seed").fill(seed);
  await region(page).getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({ timeout: 180_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: filename }).click()]);
  return download;
}

const parseFile = (path: string, lines: boolean): Record<string, unknown>[] => {
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  return lines
    ? text
        .split(/\r?\n/)
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l))
    : JSON.parse(text);
};

const kindOf = (v: unknown) => (v === null ? "null" : typeof v);

test("a file goes in and only its structure is shown", async ({ page }) => {
  await chooseJson(page, "survey.json");
  const card = page.getByTestId("json-summary");
  await expect(card).toContainText("400");
  await expect(card).toContainText("8 keys");
  await expect(card).toContainText("A list of records");
  for (const key of ["hh_id", "person_no", "income", "has_pass", "trip_date"]) await expect(card).toContainText(key);
  const text = await page.locator("body").innerText();
  for (const secret of ["PRIVATE-MARKER", "HH-1000"]) expect(text).not.toContain(secret);
});

test("an array goes in and a fake array comes out, with the same keys, order and kinds", async ({ page }, testInfo) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await chooseJson(page, "survey.json");
  await review(page);
  await expect(page.getByTestId("filter-count")).toHaveText("Showing 8 of 8 columns");

  const download = await generateAndDownload(page, /Download survey_fake\.json/);
  await expect(page.getByTestId("json-layout")).toContainText("a list of records, indented by 2 spaces");
  expect(download.suggestedFilename()).toBe("survey_fake.json");
  const fakePath = testInfo.outputPath("survey_fake.json");
  await download.saveAs(fakePath);

  const real = parseFile(join(FIX, "survey.json"), false);
  const fake = parseFile(fakePath, false);
  expect(fake).toHaveLength(real.length);
  expect(Object.keys(fake[0])).toEqual(Object.keys(real[0]));
  for (const key of Object.keys(real[0])) expect(new Set(fake.map((r) => kindOf(r[key])))).toEqual(new Set(real.map((r) => kindOf(r[key]))));
  // The layout is kept: indented by two, ending with a line break.
  const raw = readFileSync(fakePath, "utf8");
  expect(raw.startsWith('[\n  {\n    "hh_id"')).toBe(true);
  expect(raw.endsWith("]\n")).toBe(true);
  // Nothing from the real file.
  expect(raw).not.toContain("PRIVATE-MARKER");
  const origin = new URL(page.url()).origin;
  expect(requests.filter((u) => !u.startsWith(origin) && !u.startsWith("blob:") && !u.startsWith("data:"))).toEqual([]);
});

test("one record per line goes in and one record per line comes out", async ({ page }, testInfo) => {
  await chooseJson(page, "survey.ndjson");
  await expect(page.getByTestId("json-summary")).toContainText("One record per line");
  await review(page);
  const download = await generateAndDownload(page, /Download survey_fake\.ndjson/);
  await expect(page.getByTestId("json-layout")).toContainText("one record per line");
  expect(download.suggestedFilename()).toBe("survey_fake.ndjson");
  const fakePath = testInfo.outputPath("survey_fake.ndjson");
  await download.saveAs(fakePath);
  const raw = readFileSync(fakePath, "utf8");
  expect(raw.startsWith("[")).toBe(false);
  const lines = raw.split("\n").filter((l) => l.length > 0);
  expect(lines).toHaveLength(400);
  for (const line of lines) expect(Object.keys(JSON.parse(line))).toEqual(["hh_id", "person_no", "age", "income", "mode", "has_pass", "trip_date", "name"]);
  expect(raw.endsWith("}\n")).toBe(true);
});

test("null and absent keys keep their counts, and a mixed key is written as text", async ({ page }, testInfo) => {
  await chooseJson(page, "nulls_missing.json");
  await review(page);
  const download = await generateAndDownload(page, /Download nulls_missing_fake\.json/);
  const fakePath = testInfo.outputPath("nulls_missing_fake.json");
  await download.saveAs(fakePath);
  const real = parseFile(join(FIX, "nulls_missing.json"), false);
  const fake = parseFile(fakePath, false);
  for (const key of ["score", "nick", "extra"]) {
    expect(fake.filter((r) => r[key] === null).length, `null ${key}`).toBe(real.filter((r) => r[key] === null).length);
    expect(fake.filter((r) => !(key in r)).length, `absent ${key}`).toBe(real.filter((r) => !(key in r)).length);
  }

  await chooseJson(page, "mixed.json");
  await review(page);
  await expect(await shownCard(page, "code")).toContainText("text");
  const second = await generateAndDownload(page, /Download mixed_fake\.json/);
  const mixedPath = testInfo.outputPath("mixed_fake.json");
  await second.saveAs(mixedPath);
  for (const r of parseFile(mixedPath, false)) expect(typeof r.code).toBe("string");
});

test("object and list keys are marked unsupported and left out", async ({ page }, testInfo) => {
  await chooseJson(page, "nested.json");
  await expect(page.getByTestId("json-unsupported-note").getByText(/2 keys hold objects or lists/)).toBeAttached();
  await review(page);
  for (const name of ["detail", "tags"]) await expect(await shownCard(page, name)).toContainText("Left out");
  const download = await generateAndDownload(page, /Download nested_fake\.json/);
  const fakePath = testInfo.outputPath("nested_fake.json");
  await download.saveAs(fakePath);
  const raw = readFileSync(fakePath, "utf8");
  expect(raw).not.toContain("NESTED-MARKER");
  for (const r of parseFile(fakePath, false)) expect(Object.keys(r)).toEqual(["id", "label"]);
});

for (const [name, text] of [
  ["damaged.json", /not plain JSON|damaged/],
  ["items.json", /list of records/],
  ["scalar.json", /not plain JSON|damaged/],
  ["dup.json", /repeats a key/],
  ["empty.json", /no records or no keys/],
  ["comments.json", /not plain JSON|damaged/],
  ["not_json.json", /not plain JSON/],
] as const) {
  test(`${name} is refused with a plain message that quotes nothing`, async ({ page }) => {
    await page.goto(APP);
    await page.locator("#file-input").setInputFiles(join(FIX, name));
    await expect(page.getByRole("alert")).toContainText(text, { timeout: 60_000 });
    expect(await page.locator("body").innerText()).not.toContain("SECRET");
  });
}

test("a README for agents comes with the fake file and says what is in it", async ({ page }, testInfo) => {
  await chooseJson(page, "survey.json");
  await review(page);
  await generateAndDownload(page, /Download survey_fake\.json/);
  const [readme] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download README for agents" }).click()]);
  expect(readme.suggestedFilename()).toBe("survey_fake_README.md");
  const path = testInfo.outputPath("readme.md");
  await readme.saveAs(path);
  const text = readFileSync(path, "utf8");
  expect(text).toContain("This data is not real");
  expect(text).toContain("**Rows**: 400");
  expect(text).toContain("A list of records, indented by 2 spaces");
  for (const key of ["hh_id", "person_no", "income", "has_pass"]) expect(text).toContain(`\`${key}\``);
  expect(text).not.toContain("PRIVATE-MARKER");
});
