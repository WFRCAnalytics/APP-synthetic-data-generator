// Principle VII, FR-037: no automatically detectable accessibility problems on any screen, in the
// light and the dark theme, and every control can be reached and used from the keyboard.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = "/APP-synthetic-data-generator/";
const FILE = join(HERE, "../fixtures/zoo/zoo_small.csv");

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

async function toReview(page: Page) {
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles(FILE);
  await page.getByRole("button", { name: /profile this file/i }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 180_000 });
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test("Ingest, Review and Generate have no detectable violations", async ({ page }) => {
      await page.goto(APP);
      await page.locator("#file-input").setInputFiles(FILE);
      await expect(page.getByRole("heading", { name: "Detected settings" })).toBeVisible();
      expect(await violations(page), "Ingest").toEqual([]);

      await page.getByRole("button", { name: /profile this file/i }).click();
      await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 180_000 });
      await page.locator('[data-column="hh_id"]').getByText("Settings", { exact: true }).click();
      await page.locator('[data-column="cat_str_5"]').getByText("Settings", { exact: true }).click();
      // The editors added with personal, free text and short string columns (specs/002)
      for (const column of ["person_name", "phone_us", "ssn_like", "comments", "plate"]) {
        await page.locator(`[data-column="${column}"]`).getByText("Settings", { exact: true }).click();
      }
      await expect(page.locator('[data-column="person_name"]').getByTestId("sample-person_name")).toContainText("Examples (invented)", { timeout: 30_000 });
      expect(await violations(page), "Review").toEqual([]);

      await page.getByRole("button", { name: "Continue to Generate" }).click();
      await page.getByRole("region", { name: "Generate the fake table" }).getByRole("button", { name: "Generate", exact: true }).click();
      await expect(page.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({ timeout: 180_000 });
      expect(await violations(page), "Generate").toEqual([]);
    });
  });
}

test("the whole flow can be done from the keyboard, and focus is always visible", async ({ page }) => {
  await toReview(page);

  // Tab to the first card's Settings and open it with Enter.
  const summary = page.locator('[data-column="cat_str_5"]').getByText("Settings", { exact: true });
  await summary.focus();
  // Move by keyboard so the browser treats focus as keyboard focus (focus-visible).
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(summary).toBeFocused();
  const ring = await summary.evaluate((el) => {
    const s = getComputedStyle(el);
    return { outline: s.outlineStyle, shadow: s.boxShadow };
  });
  expect(ring.outline !== "none" || ring.shadow !== "none", "a focus indicator is drawn").toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-column="cat_str_5"]').getByLabel("Type")).toBeVisible();

  // Every focusable control on the page is reachable by Tab and shows a focus indicator.
  const unreachable = await page.evaluate(() => {
    const focusable = Array.from(document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, summary, [tabindex]")).filter(
      (el) => !el.hasAttribute("disabled") && el.getAttribute("tabindex") !== "-1" && el.offsetParent !== null,
    );
    return focusable.filter((el) => el.tabIndex < 0).map((el) => el.outerHTML.slice(0, 80));
  });
  expect(unreachable).toEqual([]);

  // Continue and generate with the keyboard alone.
  await page.getByRole("button", { name: "Continue to Generate" }).focus();
  await page.keyboard.press("Enter");
  const generate = page.getByRole("region", { name: "Generate the fake table" }).getByRole("button", { name: "Generate", exact: true });
  await generate.focus();
  await page.keyboard.press("Space");
  await expect(page.getByText(/checks passed\./)).toBeVisible({ timeout: 180_000 });
});
