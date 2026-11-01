// What the page shows of a chosen Parquet file (specs/005 FR-003, FR-008, FR-013): counts, column names and
// types, why a column is not supported, the size warning and the stop. Never a value.

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParquetSummary } from "../../src/features/ingest/ParquetSummary";
import { UNSUPPORTED_TEXT } from "../../src/lib/parquet/types";
import type { ParquetSummary as Summary } from "../../src/workers/protocol";

afterEach(cleanup);

const summary = (over: Partial<Summary> = {}): Summary => ({
  rowCount: 5000,
  rowGroups: 3,
  expandedBytes: 4_000_000,
  columns: [
    { name: "id16", type: { kind: "int", bits: 16, signed: true, nullable: true }, unsupported: null },
    { name: "id64", type: { kind: "int", bits: 64, signed: true, nullable: false }, unsupported: null },
    { name: "amount", type: { kind: "decimal", precision: 10, scale: 2, nullable: true }, unsupported: null },
    { name: "tsz", type: { kind: "timestamp", unit: "ms", utc: true, nullable: true }, unsupported: null },
    { name: "tags", type: null, unsupported: "nested_list" },
    { name: "pt", type: null, unsupported: "nested_struct" },
  ],
  ...over,
});

function setup(info: Summary = summary(), busy = false) {
  const onConfirm = vi.fn();
  render(<ParquetSummary fileName="survey.parquet" fileSize={3 * 1048576} info={info} onConfirm={onConfirm} busy={busy} />);
  return { onConfirm, user: userEvent.setup() };
}

describe("the structure card", () => {
  it("shows the counts, and says that no value is shown", () => {
    setup();
    const card = screen.getByTestId("parquet-summary");
    expect(card).toHaveTextContent("survey.parquet (3.0 MB)");
    expect(card).toHaveTextContent("5,000 rows, 6 columns, 3 row groups");
    expect(card).toHaveTextContent("no value and none of the file's own notes are shown");
  });

  it("says one row group in the singular", () => {
    setup(summary({ rowGroups: 1 }));
    expect(screen.getByTestId("parquet-summary")).toHaveTextContent("1 row group.");
  });

  it("lists each column with its type, marking required ones", () => {
    setup();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => Array.from(r.querySelectorAll("td")).map((c) => c.textContent));
    expect(rows.slice(0, 4)).toEqual([
      ["id16", "int16"],
      ["id64", "int64, required"],
      ["amount", "decimal(10,2)"],
      ["tsz", "timestamp[ms, UTC]"],
    ]);
  });

  it("says why a column is not supported, in the fixed words, and counts them", () => {
    setup();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => Array.from(r.querySelectorAll("td")).map((c) => c.textContent));
    expect(rows[4]).toEqual(["tags", `Not supported: ${UNSUPPORTED_TEXT.nested_list}`]);
    expect(rows[5]).toEqual(["pt", `Not supported: ${UNSUPPORTED_TEXT.nested_struct}`]);
    expect(screen.getByTestId("parquet-unsupported-note")).toHaveTextContent("2 columns are nested or of a kind that cannot be faked");
  });

  it("says nothing about unsupported columns when there are none", () => {
    setup(summary({ columns: summary().columns.slice(0, 3) }));
    expect(screen.queryByTestId("parquet-unsupported-note")).not.toBeInTheDocument();
  });

  it("shows the first 40 columns of a wide file and counts the rest", () => {
    const columns = Array.from({ length: 300 }, (_, i) => ({ name: `c${String(i).padStart(3, "0")}`, type: { kind: "int" as const, bits: 32, signed: true, nullable: true }, unsupported: null }));
    setup(summary({ columns }));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(41);
    expect(screen.getByText("and 260 more")).toBeInTheDocument();
  });

  it("holds no value-like text: only names, types and counts", () => {
    setup();
    expect(document.body.textContent).not.toMatch(/PRIVATE|min|max|created|key.?value|statistic/i);
  });
});

describe("size", () => {
  it("has no warning for a small file", () => {
    setup();
    expect(screen.queryByTestId("size-warning")).not.toBeInTheDocument();
  });

  it("warns before profiling a large file, with the memory it needs and the expanded size", () => {
    setup(summary({ expandedBytes: 400 * 1024 * 1024 }));
    expect(screen.getByTestId("size-warning")).toHaveTextContent("This file holds about 400 MB of data once opened");
    expect(screen.getByTestId("size-warning")).toHaveTextContent("1,000 MB of memory");
    expect(screen.getByRole("button", { name: "Profile this file" })).toBeEnabled();
  });

  it("refuses a file above the limit, with a way forward", () => {
    setup(summary({ expandedBytes: 3 * 1024 * 1024 * 1024 }));
    expect(screen.getByTestId("size-warning")).toHaveTextContent("more than a browser tab can read");
    expect(screen.getByTestId("size-warning")).toHaveTextContent("CSV");
    expect(screen.getByRole("button", { name: "Profile this file" })).toBeDisabled();
  });
});

describe("the button", () => {
  it("starts profiling, and is off while the file is being read", async () => {
    const { onConfirm, user } = setup();
    await user.click(screen.getByRole("button", { name: "Profile this file" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    cleanup();
    setup(summary(), true);
    expect(screen.getByRole("button", { name: "Profile this file" })).toBeDisabled();
  });
});
