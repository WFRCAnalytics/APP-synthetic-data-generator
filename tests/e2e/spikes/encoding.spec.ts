// Spike R2 (T017): does DuckDB's read_csv accept utf-16 and latin-1 in the pinned version?
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));

const DIR = join(HERE, "../../fixtures/zoo");
const PAGE = "/APP-synthetic-data-generator/spike.html";

const VARIANTS = [
  { file: "variant_utf8.csv", encoding: "utf-8" },
  { file: "variant_utf8_bom.csv", encoding: "utf-8" },
  { file: "variant_utf16le.csv", encoding: "utf-16" },
  { file: "variant_utf16be.csv", encoding: "utf-16" },
  { file: "variant_cp1252.csv", encoding: "latin-1" },
];

test("read_csv handles the supported encodings", async ({ page }) => {
  await page.goto(PAGE);
  await page.setInputFiles(
    "#files",
    VARIANTS.map((v) => join(DIR, v.file)),
  );
  const results = await page.evaluate(
    (variants) => (window as never as { spike: { encoding(v: unknown): Promise<unknown> } }).spike.encoding(variants),
    VARIANTS,
  );
  console.log("ENCODING SPIKE RESULT", JSON.stringify(results, null, 1));
  expect(Array.isArray(results)).toBe(true);
});
