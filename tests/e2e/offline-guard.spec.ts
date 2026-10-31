// A page opened straight from a file says why it cannot run, instead of staying blank (specs/004 FR-008,
// SC-006), and a served page shows no such message. Runs on the unpacked release zip, in every browser the
// project tests; needs the zip (`npm run release`).
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { unzipTo } from "../helpers/unzip";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../../release-out");
const zips = existsSync(OUT) ? readdirSync(OUT).filter((f) => f.endsWith("-offline.zip")) : [];
test.skip(zips.length === 0, "run `npm run release` first to build the zip");

let work = "";
let fileUrl = "";

test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "offline guard "));
  const names = await unzipTo(join(OUT, zips[0]), work);
  fileUrl = pathToFileURL(join(work, names[0].split("/")[0], "site", "APP-synthetic-data-generator", "index.html")).href;
});

test.afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test("a page opened from a file says to use the launcher, and has no accessibility violation", async ({ page }) => {
      await page.goto(fileUrl);
      const guard = page.locator("#offline-guard");
      await expect(guard).toBeVisible({ timeout: 10_000 });
      await expect(guard).toContainText("cannot run from a file");
      await expect(guard).toContainText("start.cmd");
      await expect(guard).toContainText("start.sh");
      await expect(guard).toContainText("README.txt");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });
  });
}

test("a served page shows no such message and runs", async ({ page }) => {
  await page.goto("/APP-synthetic-data-generator/");
  await expect(page.getByRole("heading", { name: "Choose a file" })).toBeVisible();
  await expect(page.locator("#offline-guard")).toHaveCount(0);
});
