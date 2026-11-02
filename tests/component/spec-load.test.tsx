// Loading a saved spec in place of a file (FR-004, FR-017, FR-018): a good spec goes straight to
// Review with no worker reading a file; a bad one lists its problems by column and changes nothing.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saved: Blob[] = [];
vi.mock("../../src/app/download", () => ({ downloadBlob: (blob: Blob) => void saved.push(blob) }));

import { App } from "../../src/App";
import { categorical, idColumn, installFakeWorkers, lastSpec, numeric, resetScenario, sent } from "../helpers/fakeWorkers";

type User = ReturnType<typeof userEvent.setup>;

const quantiles = Array.from({ length: 101 }, (_, i) => 10 + i * 0.9);

const goodSpec = {
  spec_version: 1,
  source: { format: "csv", file_name: "trips.csv", encoding: "utf-8", delimiter: ",", quote: '"', header: true },
  n_rows: 1000,
  seed: 7,
  columns: [
    { name: "mode", type: "categorical", quoted: false, storage: "integer", counts: { "1": 600, "2": 400 } },
    { name: "fee", type: "float", quoted: false, mode: "match_shape", min: 10, max: 100, mean: 55, sd: 26, decimals: 2, quantiles },
    { name: "hh_id", type: "survey_id", quoted: false, mask: ["digit", "digit", "digit", "digit"], min: 1000, max: 9999, repeat_structure: { "1": 600, "2": 200 } },
  ],
};

/** jsdom's File has no text(); give the test file one. */
const specFile = (value: unknown, name = "trips_spec.json") => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const file = new File([text], name, { type: "application/json" });
  Object.defineProperty(file, "text", { value: () => Promise.resolve(text) });
  return file;
};

const readBlob = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

beforeEach(() => {
  saved.length = 0;
  resetScenario([categorical("mode"), numeric("fee"), idColumn("hh_id")]);
  installFakeWorkers();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const chooseSpec = (user: User, file: File) => user.upload(screen.getByLabelText("Load existing spec"), file);
/** The detail of a column: picks it in the sidebar first when it is not the one showing. */
const card = (name: string) => {
  const showing = () => document.querySelector(`[data-column="${name}"]`) as HTMLElement | null;
  if (!showing()) fireEvent.click(document.querySelector(`[data-nav-column="${name}"]`) as HTMLElement);
  return showing() as HTMLElement;
};

const xlsxSpec = {
  ...goodSpec,
  spec_version: 3,
  source: { format: "xlsx", file_name: "survey.xlsx", sheet: "Survey Data", range: "A3:C1003", skip_rows: 2, header: true, date1904: false },
  columns: goodSpec.columns.map((c) => (c.name === "fee" ? { ...c, cell_format: "#,##0.00" } : c)),
};

describe("a workbook spec", () => {
  it("goes to Review without the workbook, names the output as a workbook, and offers cell formats", async () => {
    const user = userEvent.setup();
    render(<App />);
    await chooseSpec(user, specFile(xlsxSpec, "survey_spec.json"));
    await screen.findByRole("heading", { name: "Review columns" });
    expect(screen.getByText(/Loaded from a saved spec/)).toBeInTheDocument();
    expect(sent.profile).toHaveLength(0);
    await user.click(within(card("fee")).getByText("Settings"));
    expect(await within(card("fee")).findByLabelText("Format in the Excel file")).toHaveValue("#,##0.00");
    await user.click(screen.getByRole("button", { name: "Continue to Generate" }));
    expect(await screen.findByText(/survey_fake\.xlsx/)).toBeInTheDocument();
    expect(screen.getByTestId("one-sheet-note")).toHaveTextContent("holds one sheet, “Survey Data”");
  });

  it("leaves a CSV spec producing a CSV", async () => {
    const user = userEvent.setup();
    render(<App />);
    await chooseSpec(user, specFile(goodSpec));
    await screen.findByRole("heading", { name: "Review columns" });
    await user.click(screen.getByRole("button", { name: "Continue to Generate" }));
    expect(await screen.findByText(/trips_fake\.csv/)).toBeInTheDocument();
    expect(screen.queryByTestId("one-sheet-note")).not.toBeInTheDocument();
  });
});

const parquetSpec = {
  ...goodSpec,
  spec_version: 4,
  source: { format: "parquet", file_name: "survey.parquet", row_groups: 2 },
  columns: [
    { name: "mode", type: "categorical", quoted: false, storage: "integer", counts: { "1": 600, "2": 400 }, parquet_type: { kind: "int", bits: 16, signed: true, nullable: true } },
    { name: "fee", type: "float", quoted: false, mode: "match_shape", min: 10, max: 100, mean: 55, sd: 26, decimals: 2, quantiles, parquet_type: { kind: "decimal", precision: 10, scale: 2, nullable: false } },
    { name: "tags", type: "unsupported", exclude: "drop" },
  ],
};

describe("a Parquet spec", () => {
  it("goes to Review without the file, shows the file types, and names the output as a Parquet file", async () => {
    const user = userEvent.setup();
    render(<App />);
    await chooseSpec(user, specFile(parquetSpec, "survey_spec.json"));
    await screen.findByRole("heading", { name: "Review columns" });
    expect(screen.getByText(/Loaded from a saved spec/)).toBeInTheDocument();
    expect(sent.profile).toHaveLength(0);
    expect(within(card("fee")).getByText("File type: decimal(10,2), required")).toBeInTheDocument();
    expect(within(card("mode")).getByText("File type: int16")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue to Generate" }));
    expect(await screen.findByText(/survey_fake\.parquet/)).toBeInTheDocument();
    expect(screen.queryByTestId("one-sheet-note")).not.toBeInTheDocument();
  });

  it("saves again as a Parquet spec of the current version, with the same types", async () => {
    const user = userEvent.setup();
    render(<App />);
    await chooseSpec(user, specFile(parquetSpec, "survey_spec.json"));
    await screen.findByRole("heading", { name: "Review columns" });
    await user.click(screen.getByRole("button", { name: "Save spec (JSON)" }));
    const again = JSON.parse(await readBlob(saved.at(-1)!));
    expect(again.spec_version).toBe(4);
    expect(again.source).toEqual({ format: "parquet", file_name: "survey.parquet", row_groups: 2 });
    expect(again.columns.map((c: { parquet_type?: unknown }) => c.parquet_type)).toEqual(parquetSpec.columns.map((c) => (c as { parquet_type?: unknown }).parquet_type));
  });

  it("refuses a Parquet spec whose column has no type, listing it by column", async () => {
    const user = userEvent.setup();
    render(<App />);
    const broken = { ...parquetSpec, columns: [{ ...parquetSpec.columns[0], parquet_type: undefined }, parquetSpec.columns[1]] };
    await chooseSpec(user, specFile(broken));
    const errors = await screen.findByTestId("spec-errors");
    expect(errors).toHaveTextContent("mode");
    expect(errors).toHaveTextContent(/needs its Parquet type/);
  });

  it("leaves a CSV spec producing a CSV", async () => {
    const user = userEvent.setup();
    render(<App />);
    await chooseSpec(user, specFile(goodSpec));
    await screen.findByRole("heading", { name: "Review columns" });
    await user.click(screen.getByRole("button", { name: "Continue to Generate" }));
    expect(await screen.findByText(/trips_fake\.csv/)).toBeInTheDocument();
    expect(screen.queryByText(/File type:/)).not.toBeInTheDocument();
  });
});

describe("a good spec", () => {
  it("goes straight to Review, with a card per column and no file profiled", async () => {
    const user = userEvent.setup();
    render(<App />);
    await chooseSpec(user, specFile(goodSpec));
    await screen.findByRole("heading", { name: "Review columns" });
    expect(card("mode")).toBeInTheDocument();
    expect(card("fee")).toBeInTheDocument();
    expect(card("hh_id")).toBeInTheDocument();
    expect(screen.getByText(/Loaded from a saved spec/)).toBeInTheDocument();
    expect(sent.profile).toHaveLength(0); // nothing was opened or profiled
    expect(screen.getByText(/1,000 rows, 3 columns/)).toBeInTheDocument();
  });

  it("replaces a file that was open, so a spec and a real file are never combined (FR-004)", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.upload(screen.getByLabelText("CSV file"), new File(["mode,fee\n1,2\n"], "other.csv", { type: "text/csv" }));
    await user.click(await screen.findByRole("button", { name: /profile this file/i }));
    await screen.findByRole("heading", { name: "Review columns" });
    await user.click(screen.getByRole("button", { name: /Ingest/ }));
    await chooseSpec(user, specFile(goodSpec));
    await screen.findByText(/Loaded from a saved spec/);
    expect(screen.getByText(/trips\.csv: 1,000 rows/)).toBeInTheDocument(); // the spec's source, not other.csv
  });

  it("generates from the spec alone, with the spec's seed, and says so", async () => {
    const user = userEvent.setup();
    render(<App />);
    await chooseSpec(user, specFile(goodSpec));
    await screen.findByRole("heading", { name: "Review columns" });
    await user.click(screen.getByRole("button", { name: "Continue to Generate" }));
    const region = screen.getByRole("region", { name: "Generate the fake table" });
    expect(within(region).getByTestId("spec-only-banner")).toBeInTheDocument();
    expect(within(region).getByLabelText("Seed")).toHaveValue("7");
    await user.click(within(region).getByRole("button", { name: "Generate" }));
    await screen.findByText(/checks passed/);
    const spec = lastSpec();
    expect(spec.seed).toBe(7);
    expect(spec.n_rows).toBe(1000);
    expect(spec.columns.map((c) => c.name)).toEqual(["mode", "fee", "hh_id"]);
  });

  it("cannot profile again, and says why", async () => {
    const user = userEvent.setup();
    render(<App />);
    await chooseSpec(user, specFile(goodSpec));
    await screen.findByRole("heading", { name: "Review columns" });
    await user.click(within(card("mode")).getByText("Settings"));
    await user.selectOptions(within(card("mode")).getByLabelText("Type"), "integer");
    expect(await screen.findByRole("alert")).toHaveTextContent(/no file to read/);
    expect(sent.profile).toHaveLength(0);
  });

  it("can be saved again from Review", async () => {
    const user = userEvent.setup();
    render(<App />);
    await chooseSpec(user, specFile(goodSpec));
    await screen.findByRole("heading", { name: "Review columns" });
    await user.click(screen.getByRole("button", { name: "Save spec (JSON)" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const again = JSON.parse(await readBlob(saved[0]));
    expect(again.spec_version).toBe(4); // saved with the current version, though it was loaded from version 1
    expect(again.seed).toBe(7);
    expect(again.columns.map((c: { name: string }) => c.name)).toEqual(["mode", "fee", "hh_id"]);
  });
});

describe("a bad spec", () => {
  it("lists the problems by column and stays on Ingest", async () => {
    const user = userEvent.setup();
    render(<App />);
    const bad = JSON.parse(JSON.stringify(goodSpec));
    bad.columns[1].min = 500; // above max
    bad.columns[0].counts = { "1": 10 }; // does not add up to the rows
    await chooseSpec(user, specFile(bad));
    const errors = await screen.findByTestId("spec-errors");
    expect(errors).toHaveTextContent("fee");
    expect(errors).toHaveTextContent("mode");
    expect(screen.queryByRole("heading", { name: "Review columns" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Make test data/ })).toBeInTheDocument();
  });

  it("explains a newer spec version", async () => {
    const user = userEvent.setup();
    render(<App />);
    await chooseSpec(user, specFile({ ...goodSpec, spec_version: 5 }));
    expect(await screen.findByTestId("spec-errors")).toHaveTextContent(/newer version of the app/);
  });

  it("refuses text that is not JSON without quoting it", async () => {
    const user = userEvent.setup();
    render(<App />);
    await chooseSpec(user, specFile("hello,secret-value\n1,2\n", "oops.json"));
    const errors = await screen.findByTestId("spec-errors");
    expect(errors).toHaveTextContent(/not valid JSON/);
    expect(errors.textContent).not.toContain("secret-value");
  });

  it("leaves an open session as it was", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.upload(screen.getByLabelText("CSV file"), new File(["mode,fee\n1,2\n"], "other.csv", { type: "text/csv" }));
    await user.click(await screen.findByRole("button", { name: /profile this file/i }));
    await screen.findByRole("heading", { name: "Review columns" });
    await user.click(screen.getByRole("button", { name: /Ingest/ }));
    await chooseSpec(user, specFile("{}"));
    await screen.findByTestId("spec-errors");
    await user.click(screen.getByRole("button", { name: /Review/ }));
    expect(await screen.findByText(/other\.csv/)).toBeInTheDocument();
  });
});
