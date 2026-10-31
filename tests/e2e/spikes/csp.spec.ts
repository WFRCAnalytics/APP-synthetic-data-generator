// Spike R9 (T015): does DuckDB-WASM start under the strict page CSP, and does that CSP really make
// the browser refuse a cross-origin request?
import { expect, test } from "@playwright/test";

const PAGE = "/APP-synthetic-data-generator/spike.html";

test("DuckDB starts and answers a query under the strict CSP", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

  await page.goto(PAGE);
  await expect(page.locator("#out")).toHaveText("spike ready");

  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).not.toContain("unsafe-inline' 'wasm"); // the dev policy must not leak into the build

  const result = await page.evaluate(() => (window as never as { spike: { csp(): Promise<unknown> } }).spike.csp());
  console.log("CSP SPIKE RESULT", JSON.stringify(result), "console errors:", JSON.stringify(consoleErrors));
  expect(result).toMatchObject({ answer: 42 });
  expect((result as { violations: string[] }).violations).toEqual([]);
});

test("the CSP blocks a cross-origin request from the page", async ({ page }) => {
  await page.goto(PAGE);
  const outcome = await page.evaluate(async () => {
    const events: string[] = [];
    document.addEventListener("securitypolicyviolation", (e) => events.push(e.violatedDirective));
    let blocked = false;
    try {
      await fetch("https://example.com/");
    } catch {
      blocked = true;
    }
    await new Promise((r) => setTimeout(r, 100));
    return { blocked, events };
  });
  expect(outcome.blocked).toBe(true);
  expect(outcome.events.join(",")).toContain("connect-src");
});

test("the CSP blocks a cross-origin request from a worker", async ({ page }) => {
  await page.goto(PAGE);
  const blocked = await page.evaluate(async () => {
    const src = "self.onmessage = async () => { try { await fetch('https://example.com/'); self.postMessage('allowed'); } catch { self.postMessage('blocked'); } };";
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const worker = new Worker(url);
    return new Promise<string>((resolve) => {
      worker.onmessage = (e) => resolve(String(e.data));
      worker.onerror = () => resolve("worker-error");
      worker.postMessage("go");
    });
  });
  console.log("WORKER CROSS-ORIGIN RESULT", blocked);
  expect(["blocked", "worker-error"]).toContain(blocked);
});
