// The offline release in a real browser (specs/004 FR-001, FR-002, FR-005, FR-007, FR-014, SC-002, SC-003):
// the built zip is unpacked into a folder with a space in its name, the real launcher is started, and a
// full CSV session and a full Excel session are run with every request that is not to the launcher
// failing. The files made offline are compared with the files the hosted build makes for the same seed.
//
// Needs the zip: `npm run release` first. Without it the tests skip with that message.
import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { get as httpGet, request as httpRequest } from "node:http";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { collectFiles, parseChecksums, safeJoin, sha256Hex } from "../../scripts/release-lib.mjs";
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

    // Nothing is kept in the browser by the offline copy either (FR-016): no cookie, no stored data.
    expect(await page.context().cookies()).toEqual([]);
    const stored = await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      databases: "databases" in indexedDB ? (await indexedDB.databases()).length : 0,
    }));
    expect(stored).toEqual({ local: 0, session: 0, databases: 0 });

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

test.describe("the launcher", () => {
  test("leaves every file of the folder as released, so the checksum list still holds after use", async () => {
    const folder = launcher.folder;
    const listed = parseChecksums(readFileSync(join(folder, "CHECKSUMS.sha256"), "utf8"));
    const onDisk = (await collectFiles(folder)).filter((f) => f !== "CHECKSUMS.sha256");
    expect(onDisk).toEqual(listed.map((e) => e.path).sort());
    for (const entry of listed) {
      // start.cmd and start.ps1 are checked as released; line endings were fixed when the zip was built.
      expect(sha256Hex(readFileSync(safeJoin(folder, entry.path))), entry.path).toBe(entry.sha256);
    }
  });

  test("never serves a file to another address of this machine or to another computer", async () => {
    const port = new URL(launcher.origin).port;
    const external = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal);
    test.skip(!external, "this machine has no non-loopback address to try");
    const outcome = await new Promise<{ status?: number; body?: string; error?: string }>((resolve) => {
      const request = httpGet({ host: external!.address, port: Number(port), path: APP_PATH, timeout: 5000 }, (response) => {
        let body = "";
        response.on("data", (d) => (body += String(d)));
        response.on("end", () => resolve({ status: response.statusCode, body }));
      });
      request.on("timeout", () => {
        request.destroy();
        resolve({ error: "timeout" });
      });
      request.on("error", (e) => resolve({ error: (e as NodeJS.ErrnoException).code ?? e.message }));
    });
    // Either the connection is refused or nothing answers, or the answer is an error that holds no page.
    if (outcome.status !== undefined) {
      expect(outcome.status).not.toBe(200);
      expect(outcome.body ?? "").not.toContain('id="root"');
    }
  });

  test("answers on the loopback address", async () => {
    const response = await fetch(launcher.origin + APP_PATH);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain('id="root"');
  });
});

/** The launcher's own file for this platform. */
const launcherFile = isWindows ? "start.ps1" : "start.sh";

/** Runs the launcher from a folder until it exits, for the cases where it should refuse to start. */
function runToExit(folder: string, extra: string[]): Promise<{ code: number | null; output: string }> {
  const [command, args] = isWindows
    ? ["powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(folder, launcherFile), "--no-open", ...extra]]
    : ["sh", [join(folder, launcherFile), "--no-open", ...extra]];
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: folder, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout?.on("data", (d) => (output += String(d)));
    child.stderr?.on("data", (d) => (output += String(d)));
    const timer = setTimeout(() => child.kill(), 30_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

/** A request with the path exactly as given (fetch would tidy `..` away). */
function rawRequest(origin: string, path: string, method = "GET"): Promise<{ status: number; body: string }> {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: url.hostname, port: Number(url.port), path, method }, (res) => {
      let body = "";
      res.on("data", (d) => (body += String(d)));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test.describe("the launcher in unusual situations", () => {
  test("a second launcher takes the next port and the first keeps serving", async () => {
    const second = await startLauncher(launcher.folder);
    try {
      expect(second.origin).not.toBe(launcher.origin);
      expect(Number(new URL(second.origin).port)).toBeGreaterThan(Number(new URL(launcher.origin).port));
      for (const origin of [launcher.origin, second.origin]) expect((await fetch(origin + APP_PATH)).status).toBe(200);
    } finally {
      await second.stop();
    }
  });

  test("asking for a port that is taken stops with exit code 2 and says what to do", async () => {
    const { code, output } = await runToExit(launcher.folder, ["--port", new URL(launcher.origin).port]);
    expect(code).toBe(2);
    expect(output).toMatch(/No free port|in use/);
  });

  test("a folder without site/ stops with exit code 3", async () => {
    const empty = mkdtempSync(join(tmpdir(), "launcher no site "));
    try {
      copyFileSync(join(launcher.folder, launcherFile), join(empty, launcherFile));
      const { code, output } = await runToExit(empty, []);
      expect(code).toBe(3);
      expect(output).toMatch(/site/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test("serves nothing outside site/: traversal, a missing file and other methods are refused", async () => {
    const secret = readFileSync(join(launcher.folder, "README.txt"), "utf8").slice(0, 30);
    for (const path of [
      `${APP_PATH}../README.txt`,
      "/../README.txt",
      "/%2e%2e/README.txt",
      `${APP_PATH}%2e%2e/%2e%2e/README.txt`,
      "/..%5cREADME.txt",
      "/README.txt",
      `${APP_PATH}missing.js`,
    ]) {
      const { status, body } = await rawRequest(launcher.origin, path);
      // Refused one way or another (the Windows HTTP service may answer 400 or 403 before the launcher sees
      // an odd path); what matters is that no file outside site/ comes back.
      expect([400, 403, 404], path).toContain(status);
      expect(body, path).not.toContain(secret);
    }
    expect((await rawRequest(launcher.origin, APP_PATH, "POST")).status).toBe(405);
    expect((await rawRequest(launcher.origin, APP_PATH, "HEAD")).status).toBe(200);
  });

  test("sends the right type for the files the app needs, and never lets them be cached", async () => {
    const wasm = await fetch(`${launcher.origin}${APP_PATH}duckdb/duckdb-eh.wasm`, { method: "HEAD" }); // headers only: the file is large
    expect(wasm.headers.get("content-type")).toBe("application/wasm");
    expect(wasm.headers.get("cache-control")).toBe("no-store");
    const index = await fetch(launcher.origin + APP_PATH);
    await index.arrayBuffer();
    expect(index.headers.get("content-type")).toMatch(/^text\/html/);
    expect(index.headers.get("cache-control")).toBe("no-store");
    const asset = readdirSync(join(launcher.folder, "site", "APP-synthetic-data-generator", "assets")).find((f) => f.endsWith(".js"))!;
    const js = await fetch(`${launcher.origin}${APP_PATH}assets/${asset}`);
    await js.arrayBuffer();
    expect(js.headers.get("content-type")).toMatch(/^text\/javascript/);
  });
});
