// Parquet in a real browser under the strict content policy (specs/005 FR-001 to FR-008, FR-014): a file goes
// in, only its structure is shown, it is profiled like a CSV, a fake file comes out, and that file is opened
// with an independent reader (pyarrow) and compared with the real one. The Parquet reader is served by the site.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { shownCard } from "../helpers/review";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../fixtures/parquet");
const APP = "/APP-synthetic-data-generator/";
const region = (page: Page) => page.getByRole("region", { name: "Generate the fake table" });
const hasPyarrow = spawnSync("python", ["-c", "import pyarrow"]).status === 0;

async function chooseParquet(page: Page, name: string) {
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles(join(FIX, name));
  await expect(page.getByTestId("parquet-summary")).toBeVisible({ timeout: 60_000 });
}

async function review(page: Page) {
  await page.getByRole("button", { name: "Profile this file" }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 180_000 });
}

async function generateAndDownload(page: Page, seed = "42") {
  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await page.getByLabel("Seed").fill(seed);
  await region(page).getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({ timeout: 180_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download .*_fake\.parquet/ }).click()]);
  return download;
}

const SCHEMA_CODE = [
  "import pyarrow.parquet as pq, json, sys",
  "def read(path):",
  "    f = pq.ParquetFile(path)",
  "    return {'fields': [[x.name, str(x.type), x.nullable] for x in f.schema_arrow], 'rows': f.metadata.num_rows, 'created_by': f.metadata.created_by, 'kv': {k.decode(): v.decode() for k, v in (f.schema_arrow.metadata or {}).items()}, 'stats': any(f.metadata.row_group(g).column(c).is_stats_set for g in range(f.metadata.num_row_groups) for c in range(f.metadata.num_columns))}",
  "print(json.dumps({'real': read(sys.argv[1]), 'fake': read(sys.argv[2])}, default=str))",
].join("\n");

test("a file goes in, only its structure is shown, and the card names the unsupported columns", async ({ page }) => {
  await chooseParquet(page, "types_snappy.parquet");
  const card = page.getByTestId("parquet-summary");
  await expect(card).toContainText("5,000");
  await expect(card).toContainText("14");
  await expect(card).toContainText("3");
  await expect(page.getByTestId("parquet-unsupported-note")).toContainText("3 columns are nested");
  const text = await page.locator("body").innerText();
  for (const secret of ["PRIVATE-MARKER", "parquet-cpp", "key value metadata"]) expect(text).not.toContain(secret);
});

test("a Parquet file goes in and a fake Parquet file comes out, with the same schema", async ({ page }, testInfo) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await chooseParquet(page, "types_snappy.parquet");
  await review(page);
  await expect(page.getByTestId("filter-count")).toHaveText("Showing 14 of 14 columns");
  for (const name of ["tags", "pt", "kv"]) await expect(await shownCard(page, name)).toContainText("Left out");

  const download = await generateAndDownload(page);
  expect(download.suggestedFilename()).toBe("types_snappy_fake.parquet");
  await expect(page.getByTestId("parquet-codec")).toContainText("gzip");
  const fakePath = testInfo.outputPath("types_snappy_fake.parquet");
  await download.saveAs(fakePath);

  if (hasPyarrow) {
    const r = spawnSync("python", ["-c", SCHEMA_CODE, join(FIX, "types_snappy.parquet"), fakePath], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const { real, fake } = JSON.parse(r.stdout);
    // The scalar columns keep their names, order, types and nullability; the three nested ones are left out.
    expect(fake.fields).toEqual(real.fields.filter((f: string[]) => !["tags", "pt", "kv"].includes(f[0])));
    expect(fake.rows).toBe(real.rows);
    expect(fake.created_by).toMatch(/^synthetic-data-generator \d/);
    expect(fake.kv).toEqual({});
    expect(fake.stats).toBe(false);
  }

  // Nothing left the site, and the reader came from it.
  const origin = new URL(page.url()).origin;
  expect(requests.filter((u) => !u.startsWith(origin) && !u.startsWith("blob:") && !u.startsWith("data:"))).toEqual([]);
  expect(requests.some((u) => u.includes("/duckdb-ext/") && u.endsWith("parquet.duckdb_extension.wasm"))).toBe(true);
});

test("the same seed gives the same file, and another seed another", async ({ page }, testInfo) => {
  await chooseParquet(page, "plain.parquet");
  await review(page);
  const first = await generateAndDownload(page, "7");
  const a = testInfo.outputPath("a.parquet");
  await first.saveAs(a);

  await page.getByRole("button", { name: /Generate/ }).first().click().catch(() => undefined);
  await page.getByLabel("Seed").fill("7");
  await region(page).getByRole("button", { name: /^Generate( again)?$/ }).click();
  await expect(page.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({ timeout: 180_000 });
  const [second] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download .*_fake\.parquet/ }).click()]);
  const b = testInfo.outputPath("b.parquet");
  await second.saveAs(b);

  await page.getByLabel("Seed").fill("8");
  await region(page).getByRole("button", { name: /^Generate( again)?$/ }).click();
  await expect(page.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({ timeout: 180_000 });
  const [third] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download .*_fake\.parquet/ }).click()]);
  const c = testInfo.outputPath("c.parquet");
  await third.saveAs(c);

  const { readFileSync } = await import("node:fs");
  expect(readFileSync(a).equals(readFileSync(b))).toBe(true);
  expect(readFileSync(a).equals(readFileSync(c))).toBe(false);
});

test("a Parquet spec records only structure, and loading it without the file writes a Parquet file", async ({ page }, testInfo) => {
  await chooseParquet(page, "types_snappy.parquet");
  await review(page);
  const [specDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save spec (JSON)" }).click()]);
  const specPath = testInfo.outputPath("spec.json");
  await specDownload.saveAs(specPath);
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(specPath, "utf8");
  const spec = JSON.parse(text);
  expect(spec.spec_version).toBe(4);
  expect(spec.source).toEqual({ format: "parquet", file_name: "types_snappy.parquet", row_groups: 3 });
  expect(spec.columns.find((c: { name: string }) => c.name === "amount").parquet_type).toEqual({ kind: "decimal", precision: 10, scale: 2, nullable: true });
  // A nested column is only a name and the fact that it is left out: nothing from inside it, no type.
  for (const name of ["tags", "pt", "kv"]) {
    const column = spec.columns.find((c: { name: string }) => c.name === name);
    expect(column).toMatchObject({ name, type: "unsupported", exclude: "drop" });
    expect(Object.keys(column).sort()).toEqual(["exclude", "name", "type"]);
  }
  expect(text.length).toBeLessThan(1_000_000);
  for (const secret of ["PRIVATE-MARKER", "parquet-cpp", "created_by", "key value metadata", "min_value", "max_value"]) expect(text).not.toContain(secret);

  await page.goto(APP);
  await page.getByLabel("Load existing spec").setInputFiles(specPath);
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Loaded from a saved spec/)).toBeVisible();
  const download = await generateAndDownload(page);
  expect(download.suggestedFilename()).toBe("types_snappy_fake.parquet");
});

const REFUSALS: [string, string][] = [
  ["not_parquet.parquet", "not a Parquet file"],
  ["truncated.parquet", "damaged or incomplete"],
  ["encrypted.parquet", "encrypted"],
  ["empty.parquet", "no rows or no columns"],
];

test.describe("files that cannot be read get a clear message with no file content", () => {
  for (const [file, message] of REFUSALS) {
    test(file, async ({ page }) => {
      await page.goto(APP);
      await page.locator("#file-input").setInputFiles(join(FIX, file));
      const alert = page.getByRole("alert");
      await expect(alert).toContainText(message, { timeout: 60_000 });
      const text = await alert.innerText();
      for (const leaked of ["PAR1", "PARE", "magic", "not_parquet", "truncated", "LINE", ".parquet"]) expect(text).not.toContain(leaked);
      await expect(page.getByTestId("parquet-summary")).toHaveCount(0);
    });
  }
});
