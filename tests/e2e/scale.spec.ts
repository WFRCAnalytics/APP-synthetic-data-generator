// SC-001, SC-008, FR-031 to FR-033: a large, wide table profiles and generates within the time targets
// while the page stays responsive and shows progress.
//
// Two variants. The small one runs everywhere (CI included). The large one needs the ~500 MB fixture
// (`node scripts/make-fixtures.mjs --large`) and SCALE_500MB=1, and is meant for the reference laptop
// (4 or more cores, 16 GB, current Chrome or Edge); it takes several minutes.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = "/APP-synthetic-data-generator/";
const SMALL = join(HERE, "../fixtures/zoo/zoo_small.csv");
const LARGE = join(HERE, "../../.fixtures/zoo_500mb.csv");
const FIVE_MINUTES = 5 * 60 * 1000;

/** How long the page takes to run an animation frame: large when the main thread is blocked. */
const frameLatency = (page: Page) => page.evaluate(() => new Promise<number>((resolve) => {
  const start = performance.now();
  requestAnimationFrame(() => resolve(performance.now() - start));
}));

async function profileAndGenerate(page: Page, file: string, limitMs: number) {
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles(file);
  await expect(page.getByRole("heading", { name: "Detected settings" })).toBeVisible({ timeout: 60_000 });
  const started = Date.now();
  await page.getByRole("button", { name: /profile this file/i }).click();

  // While profiling, the page answers within a couple of seconds and shows progress or a working bar.
  await expect(page.getByRole("status").filter({ hasText: /Reading the file|Profiling columns/ })).toBeVisible({ timeout: 60_000 });
  const latencies: number[] = [];
  const review = page.getByRole("heading", { name: "Review columns" });
  while (!(await review.isVisible())) {
    latencies.push(await frameLatency(page));
    await page.waitForTimeout(1000);
    expect(Date.now() - started, "profiling took too long").toBeLessThan(limitMs);
  }
  const profileMs = Date.now() - started;

  // Review: finding a column far down the list is quick.
  const t0 = Date.now();
  await page.getByLabel("Search columns").fill("na_");
  await expect(page.locator("[data-nav-column]").first()).toBeVisible();
  const searchMs = Date.now() - t0;
  await page.getByRole("button", { name: "Clear filters" }).click();

  await page.getByRole("button", { name: "Continue to Generate" }).click();
  const generated = Date.now();
  await page.getByRole("region", { name: "Generate the fake table" }).getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({ timeout: limitMs });
  const generateMs = Date.now() - generated;

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: limitMs }), page.getByRole("button", { name: /Download .*_fake\.csv/ }).click()]);
  await download.path();

  console.log("SCALE RESULT", JSON.stringify({ profileMs, generateMs, searchMs, worstFrameMs: Math.max(0, ...latencies) }));
  expect(profileMs).toBeLessThan(limitMs);
  expect(generateMs).toBeLessThan(limitMs);
  expect(searchMs).toBeLessThan(3000);
  expect(Math.max(0, ...latencies), "the page froze while profiling").toBeLessThan(2000);
}

test("small table: profiles and generates quickly, and the page stays responsive", async ({ page }) => {
  await profileAndGenerate(page, SMALL, 2 * 60 * 1000);
});

test("500 MB table with 117 columns: profile and generate each within 5 minutes", async ({ page }) => {
  test.skip(process.env.SCALE_500MB !== "1" || !existsSync(LARGE), "set SCALE_500MB=1 and run `node scripts/make-fixtures.mjs --large` first");
  test.setTimeout(20 * 60 * 1000);
  await profileAndGenerate(page, LARGE, FIVE_MINUTES);
});
