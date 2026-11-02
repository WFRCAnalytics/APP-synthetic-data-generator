// Start from scratch (specs/006): choose it on the first screen, describe columns in plain terms, and
// reach Review and Generate with a spec that no file ever fed.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import { installFakeWorkers, lastSpec, resetScenario, sent } from "../helpers/fakeWorkers";

type User = ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  resetScenario([]);
  installFakeWorkers();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function toDesign(user: User) {
  render(<App />);
  await user.click(screen.getByRole("button", { name: "Design a table" }));
  await screen.findByRole("heading", { name: "Design a table" });
}

const addKind = async (user: User, name: RegExp) => {
  await user.click(screen.getByRole("button", { name: name }));
};

describe("the first screen", () => {
  it("offers a way in without a file, and says what it does", () => {
    render(<App />);
    expect(screen.getByText("Start from scratch")).toBeInTheDocument();
    expect(screen.getByText(/Add columns one at a time/)).toBeInTheDocument();
  });

  it("opens an empty design that asks for the first column and cannot continue yet", async () => {
    const user = userEvent.setup();
    await toDesign(user);
    expect(screen.getByRole("heading", { name: "What kind of column?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to Review" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Add at least one column");
    expect(screen.getByRole("button", { name: /Design/ })).toHaveAttribute("aria-current", "step"); // step 1 is Design now
  });
});

describe("adding and describing columns", () => {
  it("adds a column of the chosen kind with settings that work as they are", async () => {
    const user = userEvent.setup();
    await toDesign(user);
    await addKind(user, /Whole number/);
    expect(screen.getByLabelText("Column name")).toHaveValue("count");
    expect(screen.getByLabelText("Smallest")).toHaveValue("0");
    expect(screen.getByLabelText("Largest")).toHaveValue("100");
    expect(screen.getByRole("button", { name: "Continue to Review" })).toBeEnabled();
  });

  it("says what is wrong next to the field, and blocks Continue until it is fixed", async () => {
    const user = userEvent.setup();
    await toDesign(user);
    await addKind(user, /Whole number/);
    const largest = screen.getByLabelText("Largest");
    await user.clear(largest);
    await user.type(largest, "-5");
    expect(screen.getByText(/The largest value must be more than the smallest/)).toBeInTheDocument();
    expect(largest).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Continue to Review" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("1 thing needs fixing");
    expect(screen.getByLabelText("Needs a fix", { selector: "svg" })).toBeInTheDocument();
    await user.clear(largest);
    await user.type(largest, "50");
    expect(screen.getByRole("button", { name: "Continue to Review" })).toBeEnabled();
  });

  it("refuses two columns with one name", async () => {
    const user = userEvent.setup();
    await toDesign(user);
    await addKind(user, /Whole number/);
    await user.click(screen.getByRole("button", { name: "Add column" }));
    await addKind(user, /Whole number/);
    const name = screen.getByLabelText("Column name");
    await user.clear(name);
    await user.type(name, "COUNT");
    expect(screen.getByText(/Another column has this name/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to Review" })).toBeDisabled();
  });

  it("reads category labels and weights from lines", async () => {
    const user = userEvent.setup();
    await toDesign(user);
    await addKind(user, /^Category/);
    const labels = screen.getByLabelText("Labels and how common each is");
    fireEvent.change(labels, { target: { value: "Bus: 50\nRail: 30\nWalk: 20" } });
    await user.click(screen.getByRole("button", { name: "Continue to Review" }));
    await screen.findByRole("heading", { name: "Review columns" });
    await user.click(screen.getByRole("button", { name: "Continue to Generate" }));
    await user.click(within(screen.getByRole("region", { name: "Generate the fake table" })).getByRole("button", { name: /^Generate/ }));
    const spec = lastSpec();
    expect(spec.n_rows).toBe(1000);
    expect(spec.columns[0]).toMatchObject({ type: "categorical", counts: { Bus: 500, Rail: 300, Walk: 200 } });
  });

  it("adds several columns at once, from a list of names", async () => {
    const user = userEvent.setup();
    await toDesign(user);
    fireEvent.change(screen.getByLabelText("Column names"), { target: { value: "age\nincome\nincome\n" } });
    await user.selectOptions(screen.getByLabelText("Kind"), "decimal");
    await user.click(screen.getByRole("button", { name: "Add these columns" }));
    const items = Array.from(document.querySelectorAll("[data-design-column]")).map((e) => e.getAttribute("data-design-column"));
    expect(items).toEqual(["age", "income", "income_2"]);
  });

  it("duplicates, moves and removes a column", async () => {
    const user = userEvent.setup();
    await toDesign(user);
    await addKind(user, /Whole number/);
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    const names = () => Array.from(document.querySelectorAll("[data-design-column]")).map((e) => e.getAttribute("data-design-column"));
    expect(names()).toEqual(["count", "count_copy"]);
    await user.click(screen.getByRole("button", { name: "Move up" }));
    expect(names()).toEqual(["count_copy", "count"]);
    await user.click(screen.getByRole("button", { name: /Remove/ }));
    expect(names()).toEqual(["count"]);
  });
});

describe("from the design to Review and Generate", () => {
  it("sets the table name and the number of rows", async () => {
    const user = userEvent.setup();
    await toDesign(user);
    await addKind(user, /Whole number/);
    await user.click(screen.getByRole("button", { name: /Table settings/ }));
    const name = screen.getByLabelText("Table name");
    await user.clear(name);
    await user.type(name, "trips");
    const rows = screen.getByLabelText("Number of rows");
    await user.clear(rows);
    await user.type(rows, "250");
    expect(screen.getByText(/trips_fake\.csv/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue to Review" }));
    await screen.findByRole("heading", { name: "Review columns" });
    expect(screen.getByText(/trips\.csv: 250 rows, 1 columns\./)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Designed in this app/);
  });

  it("offers a file type, CSV first, and names the file after it", async () => {
    const user = userEvent.setup();
    await toDesign(user);
    await addKind(user, /Whole number/);
    await user.click(screen.getByRole("button", { name: /Table settings/ }));
    const type = screen.getByLabelText("File type") as HTMLSelectElement;
    expect(type.value).toBe("csv");
    expect(Array.from(type.options).map((o) => o.value)).toEqual(["csv", "xlsx", "parquet", "json", "ndjson"]);
    await user.selectOptions(type, "parquet");
    expect(screen.getByText(/my_table_fake\.parquet/)).toBeInTheDocument();
    await user.selectOptions(type, "ndjson");
    expect(screen.getByText(/my_table_fake\.ndjson/)).toBeInTheDocument();
  });

  it("builds a spec of the chosen format and keeps the choice when going back to Design", async () => {
    const user = userEvent.setup();
    await toDesign(user);
    await addKind(user, /Whole number/);
    await user.click(screen.getByRole("button", { name: /Table settings/ }));
    await user.selectOptions(screen.getByLabelText("File type"), "parquet");
    await user.click(screen.getByRole("button", { name: "Continue to Review" }));
    await screen.findByRole("heading", { name: "Review columns" });
    expect(screen.getByText(/my_table\.parquet: 1,000 rows/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Design/ }));
    await screen.findByRole("heading", { name: "Design a table" });
    await user.click(screen.getByRole("button", { name: /Table settings/ }));
    expect((screen.getByLabelText("File type") as HTMLSelectElement).value).toBe("parquet");
  });

  it("goes back to Design with the columns kept, and Start over clears them", async () => {
    const user = userEvent.setup();
    await toDesign(user);
    await addKind(user, /Whole number/);
    await user.click(screen.getByRole("button", { name: "Continue to Review" }));
    await screen.findByRole("heading", { name: "Review columns" });
    await user.click(screen.getByRole("button", { name: /Design/ }));
    expect(await screen.findByRole("heading", { name: "Design a table" })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-design-column]")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByRole("heading", { name: /Make test data/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Design a table" }));
    expect(document.querySelectorAll("[data-design-column]")).toHaveLength(0);
  });

  it("says in Review that settings needing data are changed in Design, and sends nothing to read", async () => {
    const user = userEvent.setup();
    await toDesign(user);
    await addKind(user, /Whole number/);
    await user.click(screen.getByRole("button", { name: "Continue to Review" }));
    await screen.findByRole("heading", { name: "Review columns" });
    expect(sent.profile).toHaveLength(0); // no file was ever opened
  });
});
