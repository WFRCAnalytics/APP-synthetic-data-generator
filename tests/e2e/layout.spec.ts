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
      await page.locator("[data-column] details.cg").evaluateAll((els) => els.forEach((d) => ((d as HTMLDetailsElement).open = true))); // every settings group open
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

// A short-string column shows one tile per character of its pattern, a row of sample values and a long hint; with every settings group
// open, nothing in the right-hand panel may reach past its right edge, at any width or text size.
const NL = String.fromCharCode(10);
const codes = ["id,tracking_code,reference_number_for_the_household_interview"]
  .concat(Array.from({ length: 300 }, (_, i) => `H${100000 + i},AB${1000 + i}-CD${5000 + i}-EF${(i * 7) % 90}-G${i % 10},REF${String(i).padStart(24, "0")}`))
  .join(NL) + NL;

for (const [width, text] of [[1280, 100], [1000, 100], [1280, 150]] as [number, number][]) {
  test(`a short-string column's settings stay inside the right-hand panel at ${width}px and ${text}% text`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto(APP);
    await page.addStyleTag({ content: `html { font-size: ${text}% !important; }` });
    await page.locator("#file-input").setInputFiles({ name: "codes_with_a_long_file_name.csv", mimeType: "text/csv", buffer: Buffer.from(codes) });
    await page.getByRole("button", { name: /profile this file/i }).click();
    await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 120_000 });
    for (const name of ["tracking_code", "reference_number_for_the_household_interview"]) {
      await pick(page, name);
      await page.waitForTimeout(400);
      const out = await page.evaluate(() => {
        const panel = document.querySelector(".review-detail") as HTMLElement;
        const edge = panel.getBoundingClientRect().left + panel.clientWidth;
        const past: string[] = [];
        for (const e of panel.querySelectorAll<HTMLElement>("*")) {
          const r = e.getBoundingClientRect();
          if (r.width > 0 && r.right > edge + 1) past.push(`${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]} +${Math.round(r.right - edge)}`);
        }
        return { scroll: panel.scrollWidth - panel.clientWidth, past };
      });
      expect(out.scroll, `${name}: the panel scrolls sideways`).toBeLessThanOrEqual(0);
      expect(out.past, `${name}: elements past the right edge`).toEqual([]);
    }
  });
}
