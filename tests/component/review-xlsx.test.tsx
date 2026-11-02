// Review for a workbook (specs/003 FR-006, FR-008, FR-009): the format of a column's cells in the Excel
// file can be chosen, a format that does not suit the column is refused, and empty text is told apart
// from blank cells in the missing-value box. Only format codes and counts are shown, never a cell value.

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColumnEditors } from "../../src/features/review/ColumnEditors";
import { cellFormatProblem } from "../../src/features/review/cellFormatProblem";
import { applyEdits } from "../../src/lib/profile/edits";
import { EMPTY_TEXT_TOKEN } from "../../src/lib/spec/types";
import { categorical, dateColumn, numeric } from "../helpers/fakeWorkers";

afterEach(cleanup);

function setup(profile = numeric("amount"), workbook = true) {
  const onEdit = vi.fn();
  const onOverride = vi.fn();
  render(<ColumnEditors profile={profile} otherNames={[]} busy={false} dateCheck={undefined} onEdit={onEdit} onOverride={onOverride} onCheckDate={() => {}} workbook={workbook} />);
  return { onEdit, onOverride, user: userEvent.setup() };
}

describe("the format of the cells", () => {
  it("is not offered for a CSV", () => {
    setup(numeric("amount"), false);
    expect(screen.queryByTestId("cell-format-editor")).not.toBeInTheDocument();
  });

  it("lists formats that suit a decimal column and applies the one chosen", async () => {
    const { onEdit, user } = setup(numeric("amount", { cellFormat: "#,##0.00" }));
    const select = screen.getByLabelText("Format in the Excel file");
    expect(select).toHaveValue("#,##0.00");
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.value)).toContain("0.00%");
    await user.selectOptions(select, "0.00%");
    expect(onEdit).toHaveBeenCalledWith({ cellFormat: "0.00%" });
  });

  it("offers date formats for a date column", () => {
    setup(dateColumn("when", { cellFormat: "mm/dd/yyyy" }));
    const values = Array.from((screen.getByLabelText("Format in the Excel file") as HTMLSelectElement).options).map((o) => o.value);
    expect(values).toContain("yyyy-mm-dd");
    expect(values).not.toContain("#,##0.00");
  });

  it("takes a custom code, and refuses one that does not suit the column", async () => {
    const { onEdit, user } = setup(numeric("amount", { cellFormat: "#,##0.00" }));
    await user.selectOptions(screen.getByLabelText("Format in the Excel file"), "Custom code…");
    const box = screen.getByLabelText("Custom format code");
    await user.clear(box);
    await user.type(box, "yyyy-mm-dd");
    expect(screen.getByRole("alert")).toHaveTextContent("A number column needs a number");
    expect(screen.getByRole("button", { name: "Use this format" })).toBeDisabled();
    await user.clear(box);
    await user.type(box, "0.0");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use this format" }));
    expect(onEdit).toHaveBeenCalledWith({ cellFormat: "0.0" });
  });

  it("shows a format that is not in the list as custom", () => {
    setup(numeric("amount", { cellFormat: "0.000" }));
    expect(screen.getByLabelText("Custom format code")).toHaveValue("0.000");
  });
});

describe("cellFormatProblem", () => {
  it("matches the spec's rules", () => {
    expect(cellFormatProblem(numeric("a"), "")).toMatch(/Enter a format code/);
    expect(cellFormatProblem(numeric("a"), "0.00")).toBeNull();
    expect(cellFormatProblem(numeric("a"), "@")).toMatch(/number column/);
    expect(cellFormatProblem(dateColumn("d"), "0.00")).toMatch(/date column/);
    expect(cellFormatProblem(dateColumn("d"), "d-mmm-yy")).toBeNull();
    expect(cellFormatProblem(categorical("c"), "mm/dd/yyyy")).toBeNull(); // dates stored as coded labels are allowed
  });

  it("allows any format for cells held as text", () => {
    expect(cellFormatProblem(numeric("zip", { storedAsText: true }), "@")).toBeNull();
  });
});

describe("applying the edit", () => {
  it("sets the format, and General clears it", () => {
    const p = numeric("amount", { cellFormat: "0.00" });
    expect(applyEdits(p, { cellFormat: "#,##0" }).cellFormat).toBe("#,##0");
    expect(applyEdits(p, { cellFormat: "General" }).cellFormat).toBeUndefined();
    expect(p.cellFormat).toBe("0.00"); // the original is untouched
  });
});

describe("blank cells and empty text", () => {
  it("shows the empty-text marker as a word and sends the token back", async () => {
    const p = categorical("flag", { naTokens: ["", EMPTY_TEXT_TOKEN, "NA"], naByToken: { "": 3, [EMPTY_TEXT_TOKEN]: 2, NA: 1 } });
    const { onOverride, user } = setup(p);
    const box = screen.getByLabelText("Words that also mean missing");
    expect(box).toHaveValue("(empty text), NA");
    expect(document.body.textContent).not.toContain(EMPTY_TEXT_TOKEN);
    await user.clear(box);
    await user.type(box, "(empty text)");
    await user.click(screen.getAllByRole("button", { name: "Apply" }).at(-1)!);
    expect(onOverride).toHaveBeenCalledWith({ naTokens: [EMPTY_TEXT_TOKEN] });
  });
});
