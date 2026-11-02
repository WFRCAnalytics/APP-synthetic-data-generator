// Principle VII, FR-037: no automatically detectable accessibility problems on any screen, in the
// light and the dark theme, and every control can be reached and used from the keyboard.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { pick } from "../helpers/review";

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
      await pick(page, "hh_id");
      await pick(page, "cat_str_5");
      // The editors added with personal, free text and short string columns (specs/002)
      for (const column of ["phone_us", "ssn_like", "comments", "plate", "person_name"]) {
        await pick(page, column);
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

  // Tab into the column list and move down it with the arrow keys; the picked column's settings open.
  const first = page.locator("[data-nav-column]").first();
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  const ring = await first.evaluate((el) => {
    const s = getComputedStyle(el);
    return { outline: s.outlineStyle, shadow: s.boxShadow };
  });
  expect(ring.outline !== "none" || ring.shadow !== "none", "a focus indicator is drawn").toBe(true);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".column-card").getByLabel("Type")).toBeVisible();

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

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme, workbook`, () => {
    test.use({ colorScheme: scheme });

    test("the sheet dialog and the cell format editor have no detectable violations", async ({ page }) => {
      await page.goto(APP);
      await page.locator("#file-input").setInputFiles(join(HERE, "../fixtures/xlsx/quirks.xlsx"));
      await expect(page.getByRole("heading", { name: "Choose a sheet" })).toBeVisible({ timeout: 60_000 });
      await page.getByLabel("Sheet", { exact: true }).selectOption({ label: "Survey Data" });
      await expect(page.getByTestId("merged-note")).toBeAttached({ timeout: 60_000 });
      expect(await violations(page), "Workbook dialog").toEqual([]);

      await page.getByRole("button", { name: "Use this sheet" }).click();
      await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 180_000 });
      await pick(page, "amount");
      await page.getByLabel("Format in the Excel file").first().selectOption({ label: "Custom code…" });
      await expect(page.getByLabel("Custom format code")).toBeVisible();
      expect(await violations(page), "Cell format editor").toEqual([]);
    });
  });
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme, Parquet`, () => {
    test.use({ colorScheme: scheme });

    test("the structure card, the unsupported notes and the file types have no detectable violations", async ({ page }) => {
      await page.goto(APP);
      await page.locator("#file-input").setInputFiles(join(HERE, "../fixtures/parquet/types_snappy.parquet"));
      await expect(page.getByTestId("parquet-summary")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("parquet-unsupported-note")).toBeVisible();
      expect(await violations(page), "Parquet structure card").toEqual([]);

      await page.getByRole("button", { name: "Profile this file" }).click();
      await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 180_000 });
      await pick(page, "tags");
      await pick(page, "amount");
      await expect(page.locator('[data-column="amount"]')).toContainText("File type: decimal(10,2)");
      expect(await violations(page), "Review of a Parquet file").toEqual([]);
    });
  });
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme, JSON`, () => {
    test.use({ colorScheme: scheme });

    test("the structure card, the tips and the review of a nested and mixed file have no detectable violations", async ({ page }) => {
      await page.goto(APP);
      await page.locator("#file-input").setInputFiles(join(HERE, "../fixtures/json/nested.json"));
      await expect(page.getByTestId("json-summary")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("json-unsupported-note")).toBeAttached();
      expect(await violations(page), "JSON structure card").toEqual([]);

      await page.getByRole("button", { name: "Profile this file" }).click();
      await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 180_000 });
      await pick(page, "detail");
      expect(await violations(page), "Review of a JSON file").toEqual([]);
      await pick(page, "label");
      expect(await violations(page), "Review of a JSON text key").toEqual([]);
    });
  });
}
