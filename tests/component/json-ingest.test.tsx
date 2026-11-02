// What the page shows of a chosen JSON file (specs/007 FR-003, FR-009, FR-013): counts, key names and kinds, why a
// key is not supported, the mixed and renamed notes, the size warning and the stop. Never a value.

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonSummary } from "../../src/features/ingest/JsonSummary";
import { JSON_UNSUPPORTED_TEXT } from "../../src/lib/json/types";
import type { JsonSummary as Summary } from "../../src/workers/protocol";

afterEach(cleanup);

const key = (name: string, over: Partial<Summary["keys"][number]> = {}): Summary["keys"][number] => ({ name, kind: "string", nulls: 0, missing: 0, mixed: false, unsupported: null, renamed: false, ...over });

const summary = (over: Partial<Summary> = {}): Summary => ({
  rowCount: 4800,
  layout: { form: "array", indent: "2", lineEnding: "lf", trailingNewline: true, bom: false },
  expandedBytes: 4_000_000,
  keys: [key("id"), key("age", { kind: "number", nulls: 12 }), key("ok", { kind: "boolean" }), key("code", { mixed: true }), key("detail", { kind: "object", unsupported: "nested_object" }), key("tags", { kind: "array", unsupported: "nested_array" })],
  ...over,
});

function setup(info: Summary = summary(), busy = false) {
  const onConfirm = vi.fn();
  render(<JsonSummary fileName="trips.json" fileSize={3 * 1048576} info={info} onConfirm={onConfirm} busy={busy} />);
  return { onConfirm, user: userEvent.setup() };
}

describe("the structure card", () => {
  it("shows the counts and the form, and the file name in a tip, with no value", () => {
    setup();
    const card = screen.getByTestId("json-summary");
    expect(card).toHaveTextContent("4,800 records, 6 keys");
    expect(card).toHaveTextContent("A list of records");
    expect(card).toHaveTextContent("trips.json (3.0 MB)");
    expect(card).toHaveTextContent("no value is shown");
  });

  it("says one record per line for a lines file", () => {
    setup(summary({ layout: { form: "lines", indent: "compact", lineEnding: "lf", trailingNewline: true, bom: false } }));
    expect(screen.getByTestId("json-summary")).toHaveTextContent("One record per line");
  });

  it("lists each key with its kind", () => {
    setup();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => Array.from(r.querySelectorAll("td")).map((c) => c.textContent));
    expect(rows.slice(0, 3)).toEqual([
      ["id", "Text"],
      ["age", "Number"],
      ["ok", "Yes or no (true, false)"],
    ]);
    expect(rows[3]).toEqual(["code", "Text, mixed kinds"]);
  });

  it("says why a key is not supported, in the fixed words, and counts them in a tip", () => {
    setup();
    expect(screen.getByText(`Not supported: ${JSON_UNSUPPORTED_TEXT.nested_object}`)).toBeInTheDocument();
    expect(screen.getByText(`Not supported: ${JSON_UNSUPPORTED_TEXT.nested_array}`)).toBeInTheDocument();
    expect(screen.getByTestId("json-unsupported-note")).toHaveTextContent("2 keys hold objects or lists");
  });

  it("says that a mixed key is read as text, in a tip", () => {
    setup();
    expect(screen.getByTestId("json-mixed-note")).toHaveTextContent("1 key mixes kinds of value");
  });

  it("names a key that was renamed by position", () => {
    setup(summary({ keys: [key("column1", { renamed: true }), key("age", { kind: "number" })] }));
    expect(screen.getByTestId("json-renamed-note")).toHaveTextContent("1 key has an empty name");
    expect(screen.getByText("(named by position)")).toBeInTheDocument();
  });

  it("has no notes when there is nothing to say", () => {
    setup(summary({ keys: [key("id"), key("n", { kind: "number" })] }));
    expect(screen.queryByTestId("json-unsupported-note")).toBeNull();
    expect(screen.queryByTestId("json-mixed-note")).toBeNull();
    expect(screen.queryByTestId("json-renamed-note")).toBeNull();
  });
});

describe("the size", () => {
  it("shows no warning for a small file", () => {
    setup();
    expect(screen.queryByTestId("size-warning")).toBeNull();
  });

  it("warns for a large file and still allows it", () => {
    setup(summary({ expandedBytes: 300 * 1048576 }));
    expect(screen.getByTestId("size-warning")).toHaveTextContent("300 MB");
    expect(screen.getByRole("button", { name: "Profile this file" })).toBeEnabled();
  });

  it("stops a file above the limit, with a way forward", () => {
    setup(summary({ expandedBytes: 1100 * 1048576 }));
    expect(screen.getByTestId("size-warning")).toHaveTextContent(/more than a browser tab can read/);
    expect(screen.getByRole("button", { name: "Profile this file" })).toBeDisabled();
  });
});

describe("profiling", () => {
  it("asks for the file to be profiled", async () => {
    const { onConfirm, user } = setup();
    await user.click(screen.getByRole("button", { name: "Profile this file" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cannot be clicked while the file is being read", () => {
    setup(summary(), true);
    expect(screen.getByRole("button", { name: "Profile this file" })).toBeDisabled();
  });
});
