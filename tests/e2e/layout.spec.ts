// Layout checks in a real browser: no panel of Review scrolls sideways, whatever the column, and a tooltip near the right edge of a
// panel opens inside the window instead of widening the panel (the "(i)" bubbles used to extend the scrollable area of the right panel).
import { join } from "node:path";
import { pick } from "../helpers/review";
import { expect, test, type Page } from "@playwright/test";

const APP = "/APP-synthetic-data-generator/";
const ZOO = join(process.cwd(), "tests/fixtures/zoo/zoo_small.csv");

async function toReview(page: Page, width: number) {
  await page.setViewportSize({ width, height: 760 });
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles(ZOO);
  await page.getByRole("button", { name: /profile this file/i }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 120_000 });
}

const sideways = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("*")]
      .filter((e) => e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1 && ["auto", "scroll"].includes(getComputedStyle(e).overflowX))
      .map((e) => `${e.tagName.toLowerCase()}.${e.className.toString().split(" ")[0]}`),
  );

for (const width of [1280, 1000]) {
  test(`no column makes a panel of Review scroll sideways at ${width}px`, async ({ page }) => {
    await toReview(page, width);
    const names = await page.locator("[data-nav-column]").evaluateAll((els) => els.map((e) => e.getAttribute("data-nav-column") as string));
    expect(names.length).toBeGreaterThan(5);
    const bad: string[] = [];
    for (const name of names) {
      await page.locator(`[data-nav-column="${name}"]`).click();
      for (const hit of await sideways(page)) bad.push(`${name}: ${hit}`);
    }
    expect(bad).toEqual([]);
  });
}

test("a tooltip near the right edge opens inside the window", async ({ page }) => {
  await toReview(page, 1280);
  await pick(page, "cat_str_5");
  const tips = page.locator(".review-detail .infotip-button");
  const count = await tips.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await tips.nth(i).hover();
    const bubble = page.locator(".review-detail .infotip-bubble").nth(i);
    await expect(bubble).toBeVisible();
    const box = (await bubble.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
    expect(box.y).toBeGreaterThanOrEqual(0);
  }
});
