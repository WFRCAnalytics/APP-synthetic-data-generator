// The load dialog for a workbook (specs/003 FR-001 to FR-003, FR-009, FR-015): sheet names in a
// dropdown with hidden ones marked, hints from the workbook's packaging, the options, and what is
// handed on when the user confirms. No cell value is ever on it.

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkbookState } from "../../src/app/session";
import { WorkbookDialog } from "../../src/features/ingest/WorkbookDialog";
import type { SheetHints } from "../../src/lib/xlsx/metadata";

afterEach(cleanup);

const hints = (over: Partial<SheetHints> = {}): SheetHints => ({
  suggestedSkipRows: 2,
  firstCol: 0,
  lastCol: 8,
  lastRow: 202,
  formats: ["@", "General", "#,##0.00"],
  mixedFormats: [],
  mergedCells: false,
  expandedBytes: 100_000,
  ...over,
});

const state = (over: Partial<WorkbookState> = {}): WorkbookState => ({
  info: {
    sheets: [
      { name: "Notes", hidden: false, veryHidden: false, expandedBytes: 1000 },
      { name: "Survey Data", hidden: false, veryHidden: false, expandedBytes: 100_000 },
      { name: "Lookup", hidden: true, veryHidden: false, expandedBytes: 500 },
    ],
    date1904: false,
    defaultSheet: "Notes",
  },
  hints: { Notes: hints({ suggestedSkipRows: 0, lastRow: 0, lastCol: 0 }), "Survey Data": hints(), Lookup: hints({ suggestedSkipRows: 0 }) },
  ...over,
});

function setup(workbook: WorkbookState = state()) {
  const onInspect = vi.fn();
  const onConfirm = vi.fn();
  render(<WorkbookDialog workbook={workbook} fileName="survey.xlsx" onInspect={onInspect} onConfirm={onConfirm} />);
  return { onInspect, onConfirm, user: userEvent.setup() };
}

describe("the sheet dropdown", () => {
  it("lists every sheet by name, marks hidden ones, and preselects the first visible sheet", () => {
    setup();
    const select = screen.getByLabelText("Sheet");
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(["Notes", "Survey Data", "Lookup (hidden)"]);
    expect(select).toHaveValue("Notes");
    expect(screen.getByText(/holds 3 sheets/)).toBeInTheDocument();
  });

  it("asks for the hints of a sheet when it is chosen", async () => {
    const { onInspect, user } = setup();
    expect(onInspect).toHaveBeenCalledWith("Notes");
    await user.selectOptions(screen.getByLabelText("Sheet"), "Survey Data");
    expect(onInspect).toHaveBeenLastCalledWith("Survey Data");
  });

  it("says when the chosen sheet is hidden", async () => {
    const { user } = setup();
    expect(screen.queryByTestId("sheet-hidden-note")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Sheet"), "Lookup");
    expect(screen.getByTestId("sheet-hidden-note")).toBeInTheDocument();
  });

  it("says it with one sheet", () => {
    setup(state({ info: { sheets: [{ name: "Only", hidden: false, veryHidden: false, expandedBytes: 1 }], date1904: false, defaultSheet: "Only" }, hints: { Only: hints() } }));
    expect(screen.getByText(/holds 1 sheet\./)).toBeInTheDocument();
  });
});

describe("the options", () => {
  it("suggests the rows to skip and the range, and explains why", async () => {
    const { user } = setup();
    await user.selectOptions(screen.getByLabelText("Sheet"), "Survey Data");
    expect(screen.getByLabelText("Rows to skip above the header")).toHaveValue("2");
    expect(screen.getByTestId("skip-suggestion")).toHaveTextContent("Suggested: 2, because the table seems to start on row 3");
    expect(screen.getByLabelText("Cell range (optional)")).toHaveValue("A3:I203");
  });

  it("changes the suggested range when the rows to skip change", async () => {
    const { user } = setup();
    await user.selectOptions(screen.getByLabelText("Sheet"), "Survey Data");
    const skip = screen.getByLabelText("Rows to skip above the header");
    await user.clear(skip);
    await user.type(skip, "4");
    expect(screen.getByLabelText("Cell range (optional)")).toHaveValue("A5:I203");
  });

  it("keeps a range the user typed when the rows to skip change", async () => {
    const { user } = setup();
    await user.selectOptions(screen.getByLabelText("Sheet"), "Survey Data");
    const range = screen.getByLabelText("Cell range (optional)");
    await user.clear(range);
    await user.type(range, "A3:C50");
    const skip = screen.getByLabelText("Rows to skip above the header");
    await user.clear(skip);
    await user.type(skip, "2");
    expect(range).toHaveValue("A3:C50");
  });

  it("refuses an invalid range, and a range that does not start after the skipped rows", async () => {
    const { user } = setup();
    await user.selectOptions(screen.getByLabelText("Sheet"), "Survey Data");
    const range = screen.getByLabelText("Cell range (optional)");
    await user.clear(range);
    await user.type(range, "nonsense");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a range such as A3:I203");
    expect(screen.getByRole("button", { name: "Use this sheet" })).toBeDisabled();
    await user.clear(range);
    await user.type(range, "A5:C50");
    expect(screen.getByRole("alert")).toHaveTextContent("must start at row 3");
    expect(screen.getByRole("button", { name: "Use this sheet" })).toBeDisabled();
  });

  it("refuses a rows-to-skip value that is not a whole number", async () => {
    const { user } = setup();
    await user.selectOptions(screen.getByLabelText("Sheet"), "Survey Data");
    const skip = screen.getByLabelText("Rows to skip above the header");
    await user.clear(skip);
    await user.type(skip, "-1");
    expect(screen.getByText("Enter a whole number, 0 or more.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this sheet" })).toBeDisabled();
  });
});

describe("confirming", () => {
  it("hands on the sheet, range, rows skipped and header setting", async () => {
    const { onConfirm, user } = setup();
    await user.selectOptions(screen.getByLabelText("Sheet"), "Survey Data");
    await user.click(screen.getByRole("button", { name: "Use this sheet" }));
    expect(onConfirm).toHaveBeenCalledWith({ sheet: "Survey Data", range: "A3:I203", skipRows: 2, header: true });
  });

  it("hands on a cleared range as none, and the header toggle", async () => {
    const { onConfirm, user } = setup();
    await user.selectOptions(screen.getByLabelText("Sheet"), "Survey Data");
    await user.clear(screen.getByLabelText("Cell range (optional)"));
    await user.click(screen.getByLabelText("First row of the table is a header"));
    await user.click(screen.getByRole("button", { name: "Use this sheet" }));
    expect(onConfirm).toHaveBeenCalledWith({ sheet: "Survey Data", range: undefined, skipRows: 2, header: false });
  });

  it("waits for the hints before it can be confirmed", () => {
    setup(state({ hints: {} }));
    expect(screen.getByRole("status")).toHaveTextContent("Looking at the sheet");
    expect(screen.getByRole("button", { name: "Use this sheet" })).toBeDisabled();
  });
});

describe("notes and warnings", () => {
  it("says merged cells were found, and when they were not checked", () => {
    setup(state({ hints: { Notes: hints({ mergedCells: true, suggestedSkipRows: 0 }) } }));
    expect(screen.getByTestId("merged-note")).toHaveTextContent("merged cells");
    cleanup();
    setup(state({ hints: { Notes: hints({ mergedCells: "not_checked", suggestedSkipRows: 0 }) } }));
    expect(screen.getByText(/merged cells were not checked/)).toBeInTheDocument();
  });

  it("names the columns whose formats are mixed", () => {
    setup(state({ hints: { Notes: hints({ mixedFormats: [0, 2], suggestedSkipRows: 0 }) } }));
    expect(screen.getByTestId("mixed-note")).toHaveTextContent("2 columns mix different kinds of number format (A, C)");
  });

  it("warns about a large sheet before profiling, with the memory it needs", () => {
    setup(state({ info: { sheets: [{ name: "Big", hidden: false, veryHidden: false, expandedBytes: 400 * 1024 * 1024 }], date1904: false, defaultSheet: "Big" }, hints: { Big: hints() } }));
    expect(screen.getByTestId("size-warning")).toHaveTextContent("400 MB of data once opened");
    expect(screen.getByTestId("size-warning")).toHaveTextContent("1,000 MB of memory");
  });

  it("has no warning for a small sheet, and shows no cell value anywhere", () => {
    setup();
    expect(screen.queryByTestId("size-warning")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/PRIVATE|secret|comment number/);
  });
});
