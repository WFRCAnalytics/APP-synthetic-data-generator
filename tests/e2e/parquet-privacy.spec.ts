// No marker from a Parquet file's data, key-value notes, creator text or statistics is anywhere it should not
// be (specs/005 FR-009, FR-010, FR-017, SC-002): the page, the saved spec, the preview, the downloaded file,
// the console and the browser's storage. The file is the one whose footer holds markers in all of those places.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { pick } from "../helpers/review";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, "../fixtures/parquet/markers.parquet");
const APP = "/APP-synthetic-data-generator/";
const region = (page: Page) => page.getByRole("region", { name: "Generate the fake table" });

/** Text that is in the real file's data, key-value notes, creator text or statistics. */
const MARKERS = ["PRIVATE-MARKER", "pandas metadata", "key value metadata", "parquet-cpp", "free text note number"];

const hasMarker = (text: string) => MARKERS.filter((m) => text.includes(m));

const hasPyarrow = spawnSync("python", ["-c", "import pyarrow"]).status === 0;

/** Every string cell, the footer text and the key-value notes of a file, decoded by pyarrow (pages are compressed, so raw bytes would hide a leak). */
function decodedText(path: string): string {
  const code = [
    "import pyarrow.parquet as pq, sys, json",
    "f = pq.ParquetFile(sys.argv[1])",
    "t = f.read()",
    "parts = [str(f.metadata.created_by)]",
    "parts += [k.decode() + '=' + v.decode() for k, v in (f.schema_arrow.metadata or {}).items()]",
    "for name in t.column_names:",
    "    parts += [str(v) for v in t.column(name).to_pylist() if isinstance(v, str)]",
    "print(json.dumps(parts))",
  ].join("\n");
  const r = spawnSync("python", ["-c", code, path], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr);
  return (JSON.parse(r.stdout) as string[]).join("\n");
}

test("no marker reaches the page, spec, preview, download, console or storage", async ({ page }, testInfo) => {
  const consoleLines: string[] = [];
  page.on("console", (m) => consoleLines.push(m.text()));
  page.on("pageerror", (e) => consoleLines.push(String(e)));

  await page.goto(APP);
  await page.locator("#file-input").setInputFiles(FILE);
  await expect(page.getByTestId("parquet-summary")).toBeVisible({ timeout: 60_000 });
  expect(hasMarker(await page.locator("body").innerText()), "structure card").toEqual([]);

  await page.getByRole("button", { name: "Profile this file" }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 180_000 });
  expect(hasMarker(await page.locator("body").innerText()), "review").toEqual([]);
  for (const column of ["who", "note", "score"]) await pick(page, column);
  expect(hasMarker(await page.locator("body").innerText()), "review settings").toEqual([]);

  const [specDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save spec (JSON)" }).click()]);
  const specPath = testInfo.outputPath("spec.json");
  await specDownload.saveAs(specPath);
  expect(hasMarker(readFileSync(specPath, "utf8")), "spec").toEqual([]);

  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await region(page).getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({ timeout: 180_000 });
  expect(hasMarker(await page.locator("body").innerText()), "preview and checks").toEqual([]);

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download .*_fake\.parquet/ }).click()]);
  const fakePath = testInfo.outputPath("markers_fake.parquet");
  await download.saveAs(fakePath);
  const bytes = readFileSync(fakePath);
  // The bytes are mostly compressed, so also check an uncompressed copy of what the writer would put in a page: the
  // names are not text of the data, and the footer holds only this app as the creator.
  expect(hasMarker(bytes.toString("latin1")), "downloaded file").toEqual([]);
  expect(bytes.toString("latin1")).toContain("synthetic-data-generator");
  if (hasPyarrow) {
    // The detector is not blind: the real file does show its markers when decoded the same way.
    expect(hasMarker(decodedText(FILE)).length).toBeGreaterThanOrEqual(3);
    expect(hasMarker(decodedText(fakePath)), "downloaded file, decoded").toEqual([]);
  }

  expect(hasMarker(consoleLines.join("\n")), "console").toEqual([]);

  const stored = await page.evaluate(async () => ({
    local: JSON.stringify(Object.entries(localStorage)),
    session: JSON.stringify(Object.entries(sessionStorage)),
    databases: "databases" in indexedDB ? (await indexedDB.databases()).length : 0,
    cookies: document.cookie,
  }));
  expect(stored).toEqual({ local: "[]", session: "[]", databases: 0, cookies: "" });
});

test("an error message from a damaged file quotes nothing from it", async ({ page }) => {
  const consoleLines: string[] = [];
  page.on("console", (m) => consoleLines.push(m.text()));
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles(join(HERE, "../fixtures/parquet/truncated.parquet"));
  await expect(page.getByRole("alert")).toContainText("damaged or incomplete", { timeout: 60_000 });
  const everything = (await page.locator("body").innerText()) + consoleLines.join("\n");
  expect(hasMarker(everything)).toEqual([]);
  expect(everything).not.toMatch(/magic bytes/);
});
