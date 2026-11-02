// Review: personal identifier, free text and short string columns (specs/002 FR-001, FR-010, FR-013,
// FR-017). The kind editor with live samples, the SSN-style acknowledgement, the notes and warnings,
// the short string pattern, and switching a slice 1 unsupported column to a kind.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import {
  categorical,
  freeTextColumn,
  installFakeWorkers,
  lastSpec,
  personalColumn,
  resetScenario,
  sent,
  shortStringColumn,
  ssnColumn,
  unsupportedColumn,
} from "../helpers/fakeWorkers";

type User = ReturnType<typeof userEvent.setup>;

const profiles = () => [
  categorical("mode"),
  personalColumn("who", "full_name"),
  personalColumn("phone", "phone", { summary: { kind: "personal", personalKind: "phone", repeatStructure: { "1": 90 }, distinct: 90, format: { shapes: [{ shape: "(999) 999-9999", share: 0.7 }, { shape: "999-999-9999", share: 0.3 }] } } }),
  personalColumn("many_first", "first_name", {}, 5000),
  ssnColumn("ssn"),
  freeTextColumn("comments"),
  shortStringColumn("plate"),
  unsupportedColumn("note"),
];

/** A short string whose pattern cannot hold its 30 distinct values, as profiling leaves it: left out, with the reason. */
const tight = () =>
  shortStringColumn("tight", { status: "needs_attention", attentionReasons: ["id_mask_too_narrow"], exclude: "drop", summary: { kind: "short_string", pattern: ["digit"], lengthGroups: { "1": 30 }, repeatStructure: { "1": 30 }, distinct: 30 } }, 30);

beforeEach(() => {
  resetScenario(profiles());
  installFakeWorkers();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function toReview(user: User) {
  await user.upload(screen.getByLabelText("Data file"), new File(["mode,who\n1,a\n"], "people.csv", { type: "text/csv" }));
  await user.click(await screen.findByRole("button", { name: /profile this file/i }));
  await screen.findByRole("heading", { name: "Review columns" });
}

/** The detail of a column: picks it in the sidebar first when it is not the one showing. */
const card = (name: string) => {
  const showing = () => document.querySelector(`[data-column="${name}"]`) as HTMLElement | null;
  if (!showing()) fireEvent.click(document.querySelector(`[data-nav-column="${name}"]`) as HTMLElement);
  return showing() as HTMLElement;
};
const open = async (user: User, name: string) => {
  await user.click(within(card(name)).getByText("Settings"));
  return card(name);
};

describe("personal kind editor", () => {
  it("shows the kind, an explanation and a live sample of invented values", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await open(user, "who");
    expect(within(c).getByLabelText("Kind")).toHaveValue("full_name");
    expect(c).toHaveTextContent("invented full names, not values from your data");
    expect(c).toHaveTextContent("90 distinct");
    await waitFor(() => expect(within(c).getByTestId("sample-who")).toHaveTextContent("full_name-sample-1"));
    expect(within(c).getByTestId("sample-who")).toHaveTextContent("Examples (invented)");
  });

  it("changes the kind, asks for new samples and sends the kind in the spec", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await open(user, "who");
    await user.selectOptions(within(c).getByLabelText("Kind"), "last_name");
    await waitFor(() => expect(within(c).getByTestId("sample-who")).toHaveTextContent("last_name-sample-1"));
    expect(sent.generate.filter((m) => m.type === "sample").length).toBeGreaterThanOrEqual(2);
    await user.click(screen.getByRole("button", { name: "Continue to Generate" }));
    await user.click(within(screen.getByRole("region", { name: "Generate the fake table" })).getByRole("button", { name: "Generate" }));
    await screen.findByText(/checks passed/);
    expect(lastSpec().columns.find((x) => x.name === "who")).toMatchObject({ type: "personal", kind: "last_name" });
  });

  it("notes that invented values use plain US English characters, for names", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    expect(await open(user, "who")).toHaveTextContent("plain US English characters");
  });

  it("shows a mix of phone formats with shares", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await open(user, "phone");
    expect(within(c).getByTestId("phone-formats-phone")).toHaveTextContent("(999) 999-9999 (70%), 999-999-9999 (30%)");
  });

  it("says when a suffix is needed to keep the values distinct", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await open(user, "many_first");
    expect(within(c).getByTestId("suffix-note-many_first")).toHaveTextContent("a short number is added");
    const who = await open(user, "who");
    expect(within(who).queryByTestId("suffix-note-who")).not.toBeInTheDocument();
  });
});

describe("social-security-style numbers", () => {
  it("are left out, with the reason, and no sample, until acknowledged", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    expect(card("ssn")).toHaveTextContent("stays left out unless you accept");
    expect(card("ssn")).toHaveTextContent("Left out");
    const c = await open(user, "ssn");
    expect(within(c).queryByTestId("sample-ssn")).not.toBeInTheDocument();
    expect(within(c).getByLabelText(/I understand that invented social-security-style numbers/)).not.toBeChecked();
    expect(within(c).getByRole("option", { name: "Include this column" })).toBeDisabled();
  });

  it("are generated once the acknowledgement is ticked, and left out again when it is cleared", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await open(user, "ssn");
    await user.click(within(c).getByLabelText(/I understand that invented social-security-style numbers/));
    await waitFor(() => expect(within(c).getByTestId("sample-ssn")).toBeInTheDocument());
    expect(within(c).getByLabelText("In the fake file")).toHaveValue("include");

    await user.click(screen.getByRole("button", { name: "Continue to Generate" }));
    await user.click(within(screen.getByRole("region", { name: "Generate the fake table" })).getByRole("button", { name: "Generate" }));
    await screen.findByText(/checks passed/);
    expect(lastSpec().columns.find((x) => x.name === "ssn")).toMatchObject({ type: "personal", kind: "ssn", acknowledged: true });

    await user.click(screen.getByRole("button", { name: /Review/ }));
    const again = await open(user, "ssn");
    await user.click(within(again).getByLabelText(/I understand that invented social-security-style numbers/));
    expect(within(again).getByLabelText("In the fake file")).toHaveValue("drop");
    expect(card("ssn")).toHaveTextContent("Left out");
  });
});

describe("free text", () => {
  it("shows the length range, the explanation and a sample", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    expect(card("comments")).toHaveTextContent("Length 3 to 400 characters");
    const c = await open(user, "comments");
    expect(c).toHaveTextContent("Only the lengths of the real text are used");
    expect(c).toHaveTextContent("no real word is kept");
    await waitFor(() => expect(within(c).getByTestId("sample-comments")).toHaveTextContent("free_text-sample-1"));
  });
});

describe("short strings", () => {
  it("shows the pattern positions and a sample", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await open(user, "plate");
    expect(within(c).getAllByLabelText(/^Position \d$/)).toHaveLength(7);
    expect(within(c).getByLabelText("Position 3")).toHaveValue("literal");
    await waitFor(() => expect(within(c).getByTestId("sample-plate")).toHaveTextContent("short_string-sample-1"));
  });

  it("explains a pattern too narrow, leaves the column out, and blocks Generate once it is included, until it is widened", async () => {
    resetScenario([...profiles(), tight()]);
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    expect(card("tight")).toHaveTextContent("allows fewer distinct values");
    expect(card("tight")).toHaveTextContent("Left out");
    const c = await open(user, "tight");
    expect(within(c).getByTestId("short-fit-tight")).toHaveTextContent("allows 10 distinct IDs but the column needs 30");

    // Included with the narrow pattern, Generate is blocked with the reason.
    await user.selectOptions(within(c).getByLabelText("In the fake file"), "include");
    await user.click(screen.getByRole("button", { name: "Continue to Generate" }));
    const region = screen.getByRole("region", { name: "Generate the fake table" });
    expect(within(region).getByRole("button", { name: "Generate" })).toBeDisabled();
    expect(within(region).getByRole("alert")).toHaveTextContent("tight: The pattern allows 10 distinct IDs");

    // Widened, the block lifts.
    await user.click(screen.getByRole("button", { name: /Review/ }));
    const again = await open(user, "tight");
    await user.selectOptions(within(again).getByLabelText("Position 1"), "alnum");
    expect(within(again).queryByTestId("short-fit-tight")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue to Generate" }));
    expect(within(screen.getByRole("region", { name: "Generate the fake table" })).getByRole("button", { name: "Generate" })).toBeEnabled();
  });
});

describe("choosing a kind for an unsupported column (FR-017)", () => {
  it("is offered in the Type selector and sent to the profile worker", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await open(user, "note");
    await user.selectOptions(within(c).getByLabelText("Type"), "free_text");
    await waitFor(() => expect(sent.profile.some((m) => m.type === "reprofile" && m.overrides.type === "free_text")).toBe(true));
  });

  it("warns when a text-like column is read as categories, because real labels would be kept", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await open(user, "who");
    await user.selectOptions(within(c).getByLabelText("Type"), "categorical");
    await waitFor(() => expect(within(card("who")).getByRole("note")).toHaveTextContent(/real values or labels from this column are kept in the spec/));
  });
});
