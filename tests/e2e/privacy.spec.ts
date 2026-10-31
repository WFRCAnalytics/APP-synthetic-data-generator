// The privacy promises (constitution Principle I), checked in a real browser under the strict CSP:
// nothing leaves the device, the counter says so, nothing is kept after a reload, and no personal
// value from the real file is ever shown.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const ZOO = join(HERE, "../fixtures/zoo");
const APP = "/APP-synthetic-data-generator/";
const THEME_KEY = "synthetic-data-generator:theme-preference:v1";

const counts = async (page: Page) => ({
  outside: Number(await page.getByTestId("net-outside").innerText()),
  local: Number(await page.getByTestId("net-local").innerText()),
});

/** Listens on the same channel the workers report to, so a test can see exactly what they fetched. */
async function watchWorkerRequests(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __net: string[] }).__net = seen;
    new BroadcastChannel("synthetic-data-generator:net").onmessage = (e) => seen.push(String(e.data?.url));
  });
}

async function runFlow(page: Page, file = "zoo_small.csv") {
  await page.goto(APP);
  await page.locator("#file-input").setInputFiles(join(ZOO, file));
  await page.getByRole("button", { name: /profile this file/i }).click();
  await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "Continue to Generate" }).click();
  await page.getByRole("region", { name: "Generate the fake table" }).getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText(/checks passed\./)).toBeVisible({ timeout: 120_000 });
}

test.describe("the network counter", () => {
  test("is on every screen and reads zero outside requests after a full session", async ({ page }) => {
    await watchWorkerRequests(page);
    await page.goto(APP);
    const counter = page.getByTestId("net-counter");
    await expect(counter).toBeVisible();
    await expect(page.getByTestId("net-outside")).toHaveText("0");

    await runFlow(page);
    await expect(counter).toBeVisible();
    const after = await counts(page);
    expect(after.outside).toBe(0);
    expect(after.local).toBeGreaterThan(0); // the app's own scripts, styles, fonts and the DuckDB module
    await expect(page.getByTestId("net-blocked")).toHaveCount(0);
    await expect(counter).toHaveAttribute("aria-label", /0 outside this site/);
  });

  test("counts what the workers fetch, including DuckDB's own module", async ({ page }) => {
    await watchWorkerRequests(page);
    await runFlow(page);
    const seen = await page.evaluate(() => (window as unknown as { __net: string[] }).__net);
    // DuckDB downloads its WebAssembly module from inside its own nested worker.
    expect(seen.some((u) => /duckdb-(eh|mvp)\.wasm$/.test(u))).toBe(true);
    const origin = new URL(page.url()).origin;
    expect(seen.every((u) => u.startsWith(origin))).toBe(true);
    // ...and the counter shows them as local requests.
    expect((await counts(page)).local).toBeGreaterThanOrEqual(seen.length);
  });

  test("shows an outside attempt as blocked and turns into a warning", async ({ page }) => {
    await page.goto(APP);
    const result = await page.evaluate(async () => {
      try {
        await fetch("https://example.com/");
        return "allowed";
      } catch {
        return "blocked";
      }
    });
    expect(result).toBe("blocked"); // the browser refused it, because of the page's policy
    await expect(page.getByTestId("net-blocked")).toHaveText("1");
    await expect(page.getByTestId("net-counter")).toHaveClass(/net-counter--alert/);
  });

  test("makes no request outside the app's own origin during a session", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await runFlow(page);
    const origin = new URL(page.url()).origin;
    const foreign = requests.filter((u) => !u.startsWith(origin) && !u.startsWith("blob:") && !u.startsWith("data:"));
    expect(foreign).toEqual([]);
  });
});

test.describe("nothing is kept", () => {
  test("browser storage holds no data after a full session, and a reload returns to the start", async ({ page, context }) => {
    await runFlow(page);

    const stored = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const opfs: string[] = [];
      for await (const key of (root as unknown as { keys(): AsyncIterable<string> }).keys()) opfs.push(key);
      return {
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
        databases: (await indexedDB.databases()).map((d) => d.name),
        caches: await caches.keys(),
        opfs,
        cookie: document.cookie,
      };
    });
    // The theme preference is the only thing the app ever stores, and only if the user changed it.
    expect(stored.local.filter((k) => k !== THEME_KEY)).toEqual([]);
    expect(stored.session).toEqual([]);
    expect(stored.databases).toEqual([]);
    expect(stored.caches).toEqual([]);
    expect(stored.opfs).toEqual([]);
    expect(stored.cookie).toBe("");
    expect(await context.cookies()).toEqual([]);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Choose a file" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Detected settings" })).toHaveCount(0);
    await expect(page.locator(".column-card")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Review/ })).toBeDisabled();
  });

  test("Start over clears the screens and the data", async ({ page }) => {
    await runFlow(page);
    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page.getByRole("heading", { name: "Choose a file" })).toBeVisible();
    await expect(page.locator(".preview-table")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start over" })).toHaveCount(0);
  });
});

test.describe("no real personal value is ever shown", () => {
  // Values from columns the app must never reproduce: personal data, free text, coordinates and
  // text IDs. Numeric IDs are left out because short numbers can match other columns by chance.
  const header = readFileSync(join(ZOO, "zoo_small.csv"), "utf8").split("\n")[0].split(",");
  const personal = ["person_name", "first_name", "last_name", "email", "email_mixed", "street_address", "phone_us", "ssn_like", "free_text", "comments", "url", "ip_address", "plate", "vendor_code", "short_code_many", "lat", "lon", "coord_pair"];

  function valuesOf(columns: string[]): string[] {
    // The zoo's personal columns contain no commas or quotes, so a plain split is exact here.
    const rows = readFileSync(join(ZOO, "zoo_small.csv"), "utf8").split("\n").slice(1, 500).map((r) => r.split(","));
    return [...new Set(columns.flatMap((c) => rows.map((r) => r[header.indexOf(c)] ?? "")).filter((v) => v.length >= 8))];
  }

  /** The made-up words of the free text columns: no real word may reach the page, the spec or the file. */
  function wordsOf(columns: string[]): string[] {
    return [...new Set(valuesOf(columns).flatMap((v) => v.split(/[\s.,]+/)).filter((w) => w.length >= 8))];
  }

  test("at every stage, in the page and in the downloaded file", async ({ page }) => {
    const secrets = [...valuesOf(personal), ...wordsOf(["free_text", "comments"])];
    expect(secrets.length).toBeGreaterThan(1000);

    const leaks = async (stage: string) => {
      const html = await page.content();
      const found = secrets.filter((v) => html.includes(v));
      expect(found, `values visible at ${stage}`).toEqual([]);
    };

    await page.goto(APP);
    await page.locator("#file-input").setInputFiles(join(ZOO, "zoo_small.csv"));
    await expect(page.getByRole("heading", { name: "Detected settings" })).toBeVisible();
    await leaks("ingest");

    await page.getByRole("button", { name: /profile this file/i }).click();
    await expect(page.getByRole("heading", { name: "Review columns" })).toBeVisible({ timeout: 120_000 });
    await leaks("review");

    await page.getByRole("button", { name: "Continue to Generate" }).click();
    await page.getByRole("region", { name: "Generate the fake table" }).getByRole("button", { name: "Generate", exact: true }).click();
    await expect(page.getByText(/checks passed\./)).toBeVisible({ timeout: 120_000 });
    await leaks("generate and preview");

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download zoo_small_fake\.csv/ }).click()]);
    const fake = readFileSync(await download.path(), "utf8");
    expect(secrets.filter((v) => fake.includes(v)), "values in the downloaded file").toEqual([]);

    const [specDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download spec/ }).click()]);
    const spec = readFileSync(await specDownload.path(), "utf8");
    expect(secrets.filter((v) => spec.includes(v)), "values in the spec").toEqual([]);
  });

  test("error messages for bad files hold no cell value", async ({ page }) => {
    const ragged = readFileSync(join(ZOO, "ragged.csv"), "utf8");
    await page.goto(APP);
    await page.locator("#file-input").setInputFiles(join(ZOO, "ragged.csv"));
    const alert = await page.getByRole("alert").innerText();
    for (const cell of ragged.split(/[\n,]/).filter((c) => c.length > 0 && c !== "a" && c !== "b" && c !== "c")) {
      expect(alert).not.toContain(cell);
    }
  });
});
