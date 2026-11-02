// Review: the ID pattern editor (FR-016, FR-017). Every pattern change shows invented examples and
// what the pattern allows against what the column needs; a pattern that is too narrow blocks Generate.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import { categorical, idColumn, installFakeWorkers, lastSpec, resetScenario } from "../helpers/fakeWorkers";

type User = ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  resetScenario([categorical("mode"), idColumn("hh_id")]);
  installFakeWorkers();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function toReview(user: User) {
  await user.upload(screen.getByLabelText("CSV file"), new File(["mode,hh_id\n1,10000\n"], "trips.csv", { type: "text/csv" }));
  await user.click(await screen.findByRole("button", { name: /profile this file/i }));
  await screen.findByRole("heading", { name: "Review columns" });
}

/** The detail of a column: picks it in the sidebar first when it is not the one showing. */
const card = (name: string) => {
  const showing = () => document.querySelector(`[data-column="${name}"]`) as HTMLElement | null;
  if (!showing()) fireEvent.click(document.querySelector(`[data-nav-column="${name}"]`) as HTMLElement);
  return showing() as HTMLElement;
};

async function editor(user: User) {
  await user.click(within(card("hh_id")).getByText("Settings"));
  return within(card("hh_id")).getByRole("group", { name: "ID pattern" });
}

describe("the ID pattern editor", () => {
  it("shows the detected pattern, a live sample of invented IDs, and what the pattern allows", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const e = await editor(user);
    expect(within(e).getAllByLabelText(/^Position \d$/)).toHaveLength(5);
    expect(within(e).getByTestId("id-sample-hh_id").textContent).toMatch(/Examples \(invented\): \d{5}(, \d{5}){4}/);
    expect(within(e).getByTestId("id-fit-hh_id")).toHaveTextContent("allows 500 distinct IDs; the column needs 500");
  });

  it("adds a fixed prefix and updates the sample at once", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const e = await editor(user);
    await user.click(within(e).getByRole("button", { name: "Remove position 1" }));
    await user.selectOptions(within(e).getByLabelText("Position 1"), "literal");
    const literal = within(e).getByLabelText("Fixed character at position 1");
    await user.clear(literal);
    await user.type(literal, "H");
    expect(within(e).getByTestId("id-sample-hh_id").textContent).toMatch(/H\d{3}/);
  });

  it("explains a shortfall, marks the column, and blocks Generate until it is widened", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const e = await editor(user);
    // Four digits with a lowest and highest number allow far fewer than the 500 IDs needed.
    await user.click(within(e).getByRole("button", { name: "Remove position 1" }));
    await user.clear(within(e).getByLabelText("Highest number"));
    await user.type(within(e).getByLabelText("Highest number"), "10099");
    expect(within(e).getByRole("alert")).toHaveTextContent("allows 100 distinct IDs but the column needs 500");
    expect(card("hh_id")).toHaveTextContent("allows fewer distinct values");

    await user.click(screen.getByRole("button", { name: "Continue to Generate" }));
    const region = screen.getByRole("region", { name: "Generate the fake table" });
    expect(within(region).getByRole("button", { name: "Generate" })).toBeDisabled();
    expect(within(region).getByRole("alert")).toHaveTextContent("hh_id: The pattern allows");

    // Leaving the column out lifts the block.
    await user.click(screen.getByRole("button", { name: /^2\. Review|Review/ }));
    await editor(user);
    await user.selectOptions(within(card("hh_id")).getByLabelText("In the fake file"), "drop");
    await user.click(screen.getByRole("button", { name: "Continue to Generate" }));
    expect(within(screen.getByRole("region", { name: "Generate the fake table" })).getByRole("button", { name: "Generate" })).toBeEnabled();
  });

  it("goes back to the detected pattern", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const e = await editor(user);
    await user.click(within(e).getByRole("button", { name: "Add position" }));
    expect(within(e).getAllByLabelText(/^Position \d$/)).toHaveLength(6);
    await user.click(within(e).getByRole("button", { name: "Reset to detected" }));
    expect(within(e).getAllByLabelText(/^Position \d$/)).toHaveLength(5);
  });

  it("sends the edited pattern, and no ID, in the spec", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const e = await editor(user);
    await user.click(within(e).getByRole("button", { name: "Add position" }));
    await user.click(screen.getByRole("button", { name: "Continue to Generate" }));
    const region = screen.getByRole("region", { name: "Generate the fake table" });
    await user.click(within(region).getByRole("button", { name: "Generate" }));
    await screen.findByText(/checks passed/);
    const col = lastSpec().columns.find((c) => c.name === "hh_id");
    expect(col).toMatchObject({ type: "survey_id" });
    expect((col as { mask: unknown[] }).mask).toHaveLength(6);
  });
});
