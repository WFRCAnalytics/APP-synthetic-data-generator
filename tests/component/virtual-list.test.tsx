// Review: a table of 120+ columns stays light and searchable (FR-010, FR-032). The card list is drawn
// through a window; the 15-second human timing of SC-008 is a manual check, here only the machinery
// is proved: few cards in the page, every column reachable, search answers quickly.

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import type { ColumnProfile } from "../../src/lib/profile/types";
import { categorical, installFakeWorkers, resetScenario } from "../helpers/fakeWorkers";

type User = ReturnType<typeof userEvent.setup>;

const COLUMNS = 150;
const list = (): ColumnProfile[] => Array.from({ length: COLUMNS }, (_, i) => categorical(`q${String(i + 1).padStart(3, "0")}`, i % 10 === 0 ? { status: "needs_attention", attentionReasons: ["possible_sentinel"] } : {}));

beforeEach(() => {
  resetScenario(list());
  installFakeWorkers();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function toReview(user: User) {
  await user.upload(screen.getByLabelText("CSV file"), new File(["a\n1\n"], "wide.csv", { type: "text/csv" }));
  await user.click(await screen.findByRole("button", { name: /profile this file/i }));
  await screen.findByRole("heading", { name: "Review columns" });
}

const inPage = () => document.querySelectorAll(".column-card").length;

describe("a table with 150 columns", () => {
  it("puts only the cards near the screen in the page, as a labelled list", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    expect(screen.getByTestId("filter-count")).toHaveTextContent(`Showing ${COLUMNS} of ${COLUMNS} columns`);
    expect(inPage()).toBeGreaterThan(0);
    expect(inPage()).toBeLessThan(COLUMNS / 2);
    const items = screen.getByRole("list", { name: "Columns" }).querySelectorAll('[role="listitem"]');
    expect(items[0]).toHaveAttribute("aria-posinset", "1");
    expect(items[0]).toHaveAttribute("aria-setsize", String(COLUMNS));
  });

  it("finds a column that is far down the list, within a few hundred milliseconds", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    expect(document.querySelector('[data-column="q149"]')).toBeNull(); // not built yet
    const box = screen.getByRole("searchbox");
    const start = performance.now();
    await user.type(box, "q149");
    await screen.findByText("Showing 1 of 150 columns");
    expect(document.querySelector('[data-column="q149"]')).not.toBeNull();
    // typing four characters, filtering 150 columns and drawing the result
    expect(performance.now() - start).toBeLessThan(1500);
  });

  it("keeps the filters working through the window", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    await user.click(screen.getByRole("checkbox", { name: /needs attention/i }));
    await screen.findByText(`Showing ${COLUMNS / 10} of ${COLUMNS} columns`);
    // 15 columns: few enough to be drawn whole
    expect(inPage()).toBe(COLUMNS / 10);
    expect(document.querySelector('[data-virtual="true"]')).toBeNull();
  });

  it("draws a short list whole, without the window", async () => {
    resetScenario(list().slice(0, 12));
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    expect(inPage()).toBe(12);
    expect(document.querySelector('[data-virtual="true"]')).toBeNull();
  });
});
