// SC-005 (specs/005): a Parquet file whose data is about 500 MB once opened loads, profiles and exports
// within the CSV time targets, with the page staying responsive. Needs the fixture
// (`python scripts/make-parquet-fixtures.py --large`) and SCALE_PARQUET=1; meant for the reference laptop.
// It prints the timings so they can be recorded in research.md.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = "/APP-synthetic-data-generator/";
const LARGE = join(HERE, "../../.fixtures/big.parquet");
const LIMIT = 10 * 60 * 1000;

const frameLatency = (page: Page) =>
  page.evaluate(() => new Promise<number>((resolve) => {
    const start = performance.now();
    requestAnimationFrame(() => resolve(performance.now() - start));
  }));

test.describe("a Parquet file of about 500 MB once opened", () => {
  test.skip(process.env.SCALE_PARQUET !== "1" || !existsSync(LARGE), "needs SCALE_PARQUET=1 and .fixtures/big.parquet");
  test.setTimeout(LIMIT * 2);

  test("loads, profiles and exports with the page staying responsive", async ({ page }) => {
    await page.goto(APP);
    await page.locator("#file-input").setInputFiles(LARGE);
    await expect(page.getByTestId("parquet-summary")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("size-warning")).toBeVisible(); // the warning comes before profiling

    const started = Date.now();
    await page.getByRole("button", { name: "Profile this file" }).click();
    const review = page.getByRole("heading", { name: "Review columns" });
    const latencies: number[] = [];
    while (!(await review.isVisible())) {
      latencies.push(await frameLatency(page));
      await page.waitForTimeout(1000);
      expect(Date.now() - started, "profiling took too long").toBeLessThan(LIMIT);
    }
    const profileMs = Date.now() - started;

    await page.getByRole("button", { name: "Continue to Generate" }).click();
    const generated = Date.now();
    await page.getByRole("region", { name: "Generate the fake table" }).getByRole("button", { name: "Generate", exact: true }).click();
    await expect(page.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({ timeout: LIMIT });
    const generateMs = Date.now() - generated;
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: LIMIT }), page.getByRole("button", { name: /Download .*_fake\.parquet/ }).click()]);
    await download.path();

    console.log("SCALE RESULT", JSON.stringify({ profileMs, generateMs, worstFrameMs: Math.max(0, ...latencies) }));
    expect(profileMs).toBeLessThan(LIMIT);
    expect(generateMs).toBeLessThan(LIMIT);
    expect(Math.max(0, ...latencies)).toBeLessThan(3000);
  });
});
