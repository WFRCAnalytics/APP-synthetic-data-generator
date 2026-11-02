// Review in a browser test: columns are listed in a sidebar and the picked one fills the right-hand pane.
import { expect, type Locator, type Page } from "@playwright/test";

export const card = (page: Page, name: string): Locator => page.locator(`[data-column="${name}"]`);

/** Picks a column in the sidebar (searching for it first, since a long list is drawn through a window). */
export async function pick(page: Page, name: string): Promise<void> {
  await showColumn(page, name);
  // The rarely needed settings sit under Advanced; a test that reaches for one finds it open.
  await card(page, name).locator("details.cg").evaluateAll((els) => els.forEach((d) => ((d as HTMLDetailsElement).open = true)));
}

async function showColumn(page: Page, name: string): Promise<void> {
  if ((await card(page, name).count()) > 0) return;
  const search = page.getByRole("searchbox", { name: "Search columns" });
  await search.fill(name);
  await page.locator(`[data-nav-column="${name}"]`).click();
  await search.fill("");
  await expect(card(page, name)).toBeVisible();
}

/** The detail of a column, picked first. */
export async function shownCard(page: Page, name: string): Promise<Locator> {
  await pick(page, name);
  return card(page, name);
}
