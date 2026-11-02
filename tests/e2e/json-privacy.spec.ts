// No marker from a JSON file's values, nested values or nested key names is anywhere it should not be (specs/007
// FR-010, FR-016, SC-002, SC-003, SC-004): the page, the saved spec, the preview, the downloaded file, the console,
// the browser's storage and every request. A saved spec is also loaded in a fresh session and gives the same bytes.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { pick } from "../helpers/review";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, "../fixtures/json/markers.json");
const APP = "/APP-synthetic-data-generator/";
const region = (page: Page) => page.getByRole("region", { name: "Generate the fake table" });

/** Text that is in the real file's values, nested values or nested key names. */
const MARKERS = ["PRIVATE-MARKER", "NESTED-MARKER", "free text note number"];
const hasMarker = (text: string) => MARKERS.filter((m) => text.includes(m));

test("no marker reaches the page, spec, preview, download, console, storage or the network", async ({ page, browser }, testInfo) => {
  const consoleLines: string[] = [];
  const requests: string[] = [];
  page.on("console", (m) => consoleLines.push(m.text()));
  page.on("pageerror", (e) => consoleLines.push(String(e)));
  page.on("request", (r) => requests.push(r.url() + " " + (r.postData() ?? "")));

  await page.goto(APP);
  await page.locator("#file-input").setInputFiles(FILE);
  await expect(page.getByTestId("json-summary")).toBeVisible({ timeout: 60_000 });
  expect(hasMarker(await page.locator("body").innerText()), "structure card").toEqual([]);

  await page.getByRole("button", { name: "Profile this file" }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 180_000 });
  expect(hasMarker(await page.locator("body").innerText()), "review").toEqual([]);
  for (const column of ["who", "note", "amount", "inner"]) await pick(page, column);
  expect(hasMarker(await page.locator("body").innerText()), "review settings").toEqual([]);

  const [specDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save spec (JSON)" }).click()]);
  const specPath = testInfo.outputPath("spec.json");
  await specDownload.saveAs(specPath);
  const specText = readFileSync(specPath, "utf8");
  expect(hasMarker(specText), "spec").toEqual([]);
  expect(JSON.parse(specText).source).toMatchObject({ format: "json", form: "array", indent: "2" });

  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await region(page).getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({ timeout: 180_000 });
  expect(hasMarker(await page.locator("body").innerText()), "preview and checks").toEqual([]);

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download .*_fake\.json/ }).click()]);
  const fakePath = testInfo.outputPath("markers_fake.json");
  await download.saveAs(fakePath);
  const fake = readFileSync(fakePath, "utf8");
  expect(hasMarker(fake), "downloaded file").toEqual([]);
  // The detector is not blind: the real file does show its markers.
  expect(hasMarker(readFileSync(FILE, "utf8")).length).toBe(3);
  expect(fake).not.toContain('"inner"');
  expect(fake).not.toContain('"list"');

  expect(hasMarker(consoleLines.join("\n")), "console").toEqual([]);
  const origin = new URL(page.url()).origin;
  expect(requests.filter((u) => !u.startsWith(origin) && !u.startsWith("blob:") && !u.startsWith("data:"))).toEqual([]);
  expect(hasMarker(requests.join("\n")), "requests").toEqual([]);

  const stored = await page.evaluate(async () => ({
    local: JSON.stringify(Object.entries(localStorage)),
    session: JSON.stringify(Object.entries(sessionStorage)),
    databases: "databases" in indexedDB ? (await indexedDB.databases()).length : 0,
    cookies: document.cookie,
  }));
  expect(stored).toEqual({ local: "[]", session: "[]", databases: 0, cookies: "" });

  // The saved spec, loaded in a fresh session without the file, gives the same bytes (SC-004).
  const fresh = await (await browser.newContext({ acceptDownloads: true })).newPage();
  await fresh.goto(APP);
  await fresh.getByLabel("Load existing spec").setInputFiles({ name: "markers_spec.json", mimeType: "application/json", buffer: Buffer.from(specText) });
  await expect(fresh.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 30_000 });
  await fresh.getByRole("button", { name: "Continue to Generate" }).click();
  await fresh.getByLabel("Seed").fill("42");
  await region(fresh).getByRole("button", { name: "Generate", exact: true }).click();
  await expect(fresh.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({ timeout: 60_000 });
  const [again] = await Promise.all([fresh.waitForEvent("download"), fresh.getByRole("button", { name: /Download .*_fake\.json/ }).click()]);
  const againPath = testInfo.outputPath("again.json");
  await again.saveAs(againPath);

  // Same spec and seed in this session as well.
  await page.getByLabel("Seed").fill("42");
  await region(page).getByRole("button", { name: /^Generate( again)?$/ }).click();
  await expect(page.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({ timeout: 60_000 });
  const [same] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download .*_fake\.json/ }).click()]);
  const samePath = testInfo.outputPath("same.json");
  await same.saveAs(samePath);
  expect(readFileSync(againPath, "utf8")).toBe(readFileSync(samePath, "utf8"));
});

test("an error message from a damaged file quotes nothing from it", async ({ page }) => {
  const consoleLines: string[] = [];
  page.on("console", (m) => consoleLines.push(m.text()));
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles(join(HERE, "../fixtures/json/damaged.json"));
  await expect(page.getByRole("alert")).toContainText("not plain JSON", { timeout: 60_000 });
  const everything = (await page.locator("body").innerText()) + consoleLines.join("\n");
  expect(everything).not.toMatch(/SECRET|byte \d|Malformed|first character|source_\d/);
});
