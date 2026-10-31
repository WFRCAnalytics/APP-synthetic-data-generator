// Spike R14 (T018): can a ~500 MB Blob be assembled from chunks and downloaded in Chromium?
import { statSync } from "node:fs";
import { expect, test } from "@playwright/test";

const PAGE = "/APP-synthetic-data-generator/spike.html";
const MB = 500;

test("a 500 MB Blob downloads without running out of memory", async ({ page }) => {
  await page.goto(PAGE);
  const [download, result] = await Promise.all([
    page.waitForEvent("download", { timeout: 10 * 60 * 1000 }),
    page.evaluate((mb) => (window as never as { spike: { download(n: number): Promise<unknown> } }).spike.download(mb), MB),
  ]);
  const path = await download.path();
  const size = statSync(path).size;
  console.log("DOWNLOAD SPIKE RESULT", JSON.stringify({ result, downloadedMb: Math.round(size / 1048576) }));
  expect(size).toBe(MB * 1024 * 1024);
});
