// Review: finding a column among many (FR-010): search, the "needs attention" filter, the type
// filter, the count, and the banner of columns the profiler was unsure about.

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import type { ColumnProfile } from "../../src/lib/profile/types";
import { categorical, dateColumn, installFakeWorkers, numeric, resetScenario, unsupportedColumn } from "../helpers/fakeWorkers";

type User = ReturnType<typeof userEvent.setup>;

function manyColumns(): ColumnProfile[] {
  const list: ColumnProfile[] = [
    categorical("hh_size"),
    categorical("mode", { attentionReasons: ["possible_sentinel"], status: "needs_attention", sentinels: { "-9": 4 } }),
    categorical("purpose"),
    numeric("trip_dist_mi"),
    numeric("trip_minutes", { type: "integer", detectedType: "integer" }),
    numeric("income", { attentionReasons: ["near_categorical_threshold"], status: "needs_attention", type: "integer", detectedType: "integer" }),
    dateColumn("travel_date"),
    unsupportedColumn("email"),
    unsupportedColumn("home_address"),
  ];
  // A table of 100+ columns, as household surveys have.
  for (let i = 1; i <= 110; i++) list.push(categorical(`q${String(i).padStart(3, "0")}`));
  return list;
}

beforeEach(() => {
  resetScenario(manyColumns());
  installFakeWorkers();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const file = () => new File(["a,b\n1,2\n"], "trips.csv", { type: "text/csv" });

async function toReview(user: User) {
  await user.upload(screen.getByLabelText("CSV file"), file());
  await user.click(await screen.findByRole("button", { name: /profile this file/i }));
  await screen.findByRole("heading", { name: "Review columns" });
}

const shownNames = () => Array.from(document.querySelectorAll(".column-card")).map((c) => c.getAttribute("data-column"));
const count = () => screen.getByTestId("filter-count").textContent;

describe("a table with more than a hundred columns", () => {
  it("shows every column and says how many", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    expect(shownNames()).toHaveLength(119);
    expect(count()).toBe("Showing 119 of 119 columns");
  });
});

describe("search", () => {
  it("narrows the list as the user types, ignoring case", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    await user.type(screen.getByLabelText("Search columns"), "TRIP");
    expect(shownNames()).toEqual(["trip_dist_mi", "trip_minutes"]);
    expect(count()).toBe("Showing 2 of 119 columns");
  });

  it("finds a column in a long list by a part of its name", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    await user.type(screen.getByLabelText("Search columns"), "q087");
    expect(shownNames()).toEqual(["q087"]);
  });

  it("says so when nothing matches, and offers to clear the filters", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    await user.type(screen.getByLabelText("Search columns"), "no such column");
    expect(shownNames()).toEqual([]);
    expect(screen.getByText("No columns match these filters.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(shownNames()).toHaveLength(119);
  });

  it("ignores leading and trailing spaces", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    await user.type(screen.getByLabelText("Search columns"), "  mode ");
    expect(shownNames()).toEqual(["mode"]);
  });
});

describe("the needs-attention filter", () => {
  it("shows only the columns that need a look, including unsupported ones", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    await user.click(screen.getByLabelText("Needs attention only"));
    expect(shownNames()).toEqual(["mode", "income", "email", "home_address"]);
    expect(count()).toBe("Showing 4 of 119 columns");
  });

  it("combines with the search", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    await user.click(screen.getByLabelText("Needs attention only"));
    await user.type(screen.getByLabelText("Search columns"), "e");
    expect(shownNames()).toEqual(["mode", "income", "email", "home_address"].filter((n) => n.includes("e")));
  });
});

describe("the type filter", () => {
  it("lists the types present with their counts", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const select = screen.getByRole("search", { name: "Filter columns" }).querySelector("select") as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain("All types");
    expect(labels).toContain("Categorical (113)");
    expect(labels).toContain("Unsupported in this version (2)");
    expect(labels).toContain("Date (1)");
  });

  it("shows one type", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const search = screen.getByRole("search", { name: "Filter columns" });
    await user.selectOptions(within(search).getByLabelText("Type"), "unsupported");
    expect(shownNames()).toEqual(["email", "home_address"]);
    await user.selectOptions(within(search).getByLabelText("Type"), "integer");
    expect(shownNames()).toEqual(["trip_minutes", "income"]);
  });

  it("combines with the other filters", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const search = screen.getByRole("search", { name: "Filter columns" });
    await user.selectOptions(within(search).getByLabelText("Type"), "integer");
    await user.click(screen.getByLabelText("Needs attention only"));
    expect(shownNames()).toEqual(["income"]);
  });

  it("clears every filter at once", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const search = screen.getByRole("search", { name: "Filter columns" });
    await user.selectOptions(within(search).getByLabelText("Type"), "integer");
    await user.type(screen.getByLabelText("Search columns"), "in");
    await user.click(screen.getByLabelText("Needs attention only"));
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(shownNames()).toHaveLength(119);
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });
});

describe("the banner of columns that need a look", () => {
  it("counts them, names them and says how many are left out", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const banner = document.querySelector(".attention-banner") as HTMLElement;
    expect(banner).toHaveTextContent("4 columns need a look; 2 will be left out of the fake file.");
    expect(banner).toHaveTextContent("mode, income, email, home_address");
  });

  it("explains the commonest reasons", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const banner = document.querySelector(".attention-banner") as HTMLElement;
    expect(within(banner).getByText(/2 × This kind of column is not supported/)).toBeInTheDocument();
    expect(within(banner).getByText(/1 × Some values look like codes/)).toBeInTheDocument();
  });

  it("jumps to just those columns and back", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    await user.click(screen.getByRole("button", { name: "Show only these columns" }));
    expect(shownNames()).toEqual(["mode", "income", "email", "home_address"]);
    expect(screen.getByLabelText("Needs attention only")).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Show all columns" }));
    expect(shownNames()).toHaveLength(119);
  });

  it("names only the first few when many columns need a look", async () => {
    resetScenario(Array.from({ length: 20 }, (_, i) => unsupportedColumn(`bad_${i}`)));
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const banner = document.querySelector(".attention-banner") as HTMLElement;
    expect(banner).toHaveTextContent("20 columns need a look; 20 will be left out");
    expect(banner).toHaveTextContent("and 12 more");
  });

  it("is not shown when every column is fine", async () => {
    resetScenario([categorical("a"), numeric("b")]);
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    expect(document.querySelector(".attention-banner")).toBeNull();
  });

  it("says \"column\" (not \"columns\") when exactly one needs a look", async () => {
    resetScenario([categorical("a", { status: "needs_attention", attentionReasons: ["possible_sentinel"], sentinels: { "-9": 2 } }), categorical("b")]);
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    expect(document.querySelector(".attention-banner")).toHaveTextContent("1 column needs a look");
  });
});
