// The offline release in a real browser (specs/004 FR-001, FR-002, FR-005, FR-007, FR-014, SC-002, SC-003):
// the built zip is unpacked into a folder with a space in its name, the real launcher is started, and a
// full CSV session and a full Excel session are run with every request that is not to the launcher
// failing. The files made offline are compared with the files the hosted build makes for the same seed.
//
// Needs the zip: `npm run release` first. Without it the tests skip with that message.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { readEntryText, readZipDirectory } from "../../src/lib/xlsx/zip";
import { unzipTo } from "../helpers/unzip";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const OUT = join(ROOT, "release-out");
const zips = existsSync(OUT) ? readdirSync(OUT).filter((f) => f.endsWith("-offline.zip")) : [];
const ZIP = zips.length > 0 ? join(OUT, zips[0]) : "";
const APP_PATH = "/APP-synthetic-data-generator/";
const SEED = "424242";

test.skip(!ZIP, "run `npm run release` first to build the zip");

interface Launcher {
  origin: string;
  folder: string;
  child: ChildProcess;
  output: () => string;
  stop: () => Promise<void>;
}

const isWindows = process.platform === "win32";

/** Starts the launcher the way the README says, from the unpacked folder, without opening a browser. */
async function startLauncher(folder: string, extra: string[] = []): Promise<Launcher> {
  const [command, args] = isWindows
    ? ["powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(folder, "start.ps1"), "--no-open", ...extra]]
    : ["sh", [join(folder, "start.sh"), "--no-open", ...extra]];
  const child = spawn(command, args, { cwd: folder, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout?.on("data", (d) => (out += String(d)));
  child.stderr?.on("data", (d) => (out += String(d)));
  const started = Date.now();
  let url: string | undefined;
  while (!url && Date.now() - started < 30_000) {
    url = /URL: (http:\/\/127\.0\.0\.1:\d+)\//.exec(out)?.[1];
    if (!url) await new Promise((r) => setTimeout(r, 100));
  }
  if (!url) {
    child.kill();
    throw new Error(`the launcher printed no URL line:\n${out}`);
  }
  return {
    origin: url,
    folder,
    child,
    output: () => out,
    stop: async () => {
      if (isWindows && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
      else child.kill();
      await new Promise((r) => setTimeout(r, 300));
    },
  };
}

let work = "";
let launcher: Launcher;
let top = "";

test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "offline zip test "));
  const names = await unzipTo(ZIP, work);
  top = names[0].split("/")[0];
  launcher = await startLauncher(join(work, top));
});

test.afterAll(async () => {
  await launcher?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

/** Every request the page makes: refuses anything that is not to the launcher and records it. */
async function guarded(page: Page, origin: string) {
  const seen: string[] = [];
  await page.context().route("**/*", (route) => {
    const url = route.request().url();
    seen.push(url);
    if (url.startsWith(origin) || url.startsWith("blob:") || url.startsWith("data:")) return route.continue();
    return route.abort("blockedbyclient");
  });
  page.on("request", (r) => seen.push(r.url()));
  const outside = () => seen.filter((u) => !u.startsWith(origin) && !u.startsWith("blob:") && !u.startsWith("data:"));
  return { seen, outside };
}

async function generateAndDownload(page: Page, suffix: string): Promise<Buffer> {
  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await page.getByLabel("Seed").fill(SEED);
  await page.getByRole("region", { name: "Generate the fake table" }).getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText(/checks passed\.|checks did not pass\./)).toBeVisible({ timeout: 180_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: new RegExp(`Download .*_fake\\.${suffix}`) }).click()]);
  const path = await download.path();
  return readFileSync(path);
}

async function csvSession(page: Page, base: string): Promise<Buffer> {
  await page.goto(base + APP_PATH);
  await page.locator("#file-input").setInputFiles(join(ROOT, "tests/fixtures/zoo/zoo_small.csv"));
  await expect(page.getByRole("heading", { name: "Detected settings" })).toBeVisible();
  await page.getByRole("button", { name: /profile this file/i }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 180_000 });
  return generateAndDownload(page, "csv");
}

async function excelSession(page: Page, base: string): Promise<Buffer> {
  await page.goto(base + APP_PATH);
  await page.locator("#file-input").setInputFiles(join(ROOT, "tests/fixtures/xlsx/quirks.xlsx"));
  await expect(page.getByRole("heading", { name: "Choose a sheet" })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Sheet", { exact: true }).selectOption({ label: "Survey Data" });
  await expect(page.getByLabel("Rows to skip above the header")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Use this sheet" }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 180_000 });
  return generateAndDownload(page, "xlsx");
}

/** Runs a session on the hosted build in its own context, so the guard of the offline page does not apply. */
async function onHostedCopy(page: Page, run: (hosted: Page) => Promise<Buffer>): Promise<Buffer> {
  const context = await page.context().browser()!.newContext({ acceptDownloads: true });
  try {
    return await run(await context.newPage());
  } finally {
    await context.close();
  }
}

/** The cells of the one sheet of a workbook, as its sheet XML. */
async function sheetXml(bytes: Buffer): Promise<string> {
  const blob = new Blob([bytes as BlobPart]);
  const entries = await readZipDirectory(blob);
  return readEntryText(blob, entries.find((e) => e.name === "xl/worksheets/sheet1.xml")!);
}

test.describe("offline copy", () => {
  test("a full CSV session works with every request not to the launcher refused, and matches the hosted build", async ({ page, baseURL }) => {
    const { outside } = await guarded(page, launcher.origin);
    const offline = await csvSession(page, launcher.origin);
    expect(outside()).toEqual([]);
    await expect(page.getByTestId("net-outside")).toHaveText("0");
    expect(offline.length).toBeGreaterThan(1000);

    const hosted = await onHostedCopy(page, (second) => csvSession(second, baseURL!));
    expect(offline.equals(hosted)).toBe(true);
  });

  test("a full Excel session works offline, and its workbook has the cells the hosted build writes", async ({ page, baseURL }) => {
    const { outside, seen } = await guarded(page, launcher.origin);
    const offline = await excelSession(page, launcher.origin);
    expect(outside()).toEqual([]);
    expect(seen.some((u) => u.includes("/duckdb-ext/") && u.endsWith("excel.duckdb_extension.wasm"))).toBe(true); // the extension came from the folder
    await expect(page.getByTestId("net-outside")).toHaveText("0");

    const hosted = await onHostedCopy(page, (second) => excelSession(second, baseURL!));
    expect(await sheetXml(offline)).toBe(await sheetXml(hosted));
  });
});
