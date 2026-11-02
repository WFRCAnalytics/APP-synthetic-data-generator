// Review: every automatic decision can be changed before generating (FR-005 to FR-013, FR-038).
// Mock workers follow the real protocol; the spec sent to the generate worker shows what a change
// finally does.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import { categorical, dateColumn, installFakeWorkers, lastSpec, numeric, resetScenario, scenario, sent, unsupportedColumn } from "../helpers/fakeWorkers";

type User = ReturnType<typeof userEvent.setup>;

const profiles = () => [
  categorical("mode"),
  numeric("dist", { attentionReasons: ["possible_sentinel"], status: "needs_attention", sentinels: { "-9": 5 } }),
  dateColumn("when"),
  unsupportedColumn("email"),
];

beforeEach(() => {
  resetScenario(profiles());
  installFakeWorkers();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const file = () => new File(["mode,dist\n1,2\n"], "trips.csv", { type: "text/csv" });

async function toReview(user: User) {
  await user.upload(screen.getByLabelText("Data file"), file());
  await user.click(await screen.findByRole("button", { name: /profile this file/i }));
  await screen.findByRole("heading", { name: "Review columns" });
}

/** The detail of a column: picks it in the sidebar first when it is not the one showing. */
const card = (name: string) => {
  const showing = () => document.querySelector(`[data-column="${name}"]`) as HTMLElement | null;
  if (!showing()) fireEvent.click(document.querySelector(`[data-nav-column="${name}"]`) as HTMLElement);
  return showing() as HTMLElement;
};

/** The type badges on a card (the select's options also say the type, so text alone is ambiguous). */
const badges = (name: string) => Array.from(card(name).querySelectorAll(".badge")).map((b) => b.textContent);

/** Picks the column in the sidebar; its settings fill the right-hand pane. */
async function openSettings(user: User, name: string) {
  await user.click(document.querySelector(`[data-nav-column="${name}"]`) as HTMLElement);
  return card(name);
}

/** The Apply button of the form that holds a labelled text box. */
const applyFor = (c: HTMLElement, label: string | RegExp, button: string | RegExp = "Apply") =>
  within(within(c).getByLabelText(label).closest("form") as HTMLElement).getByRole("button", { name: button });

async function generated(user: User) {
  await user.click(screen.getByRole("button", { name: "Continue to Generate" }));
  const region = screen.getByRole("region", { name: "Generate the fake table" });
  await user.click(within(region).getByRole("button", { name: /^Generate( again)?$/ })); // it reads "again" after a first run
  await screen.findByText(/checks passed/);
  return lastSpec();
}

describe("the settings of a column", () => {
  it("fill the right-hand pane for the picked column, and only that one", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    expect(document.querySelector("[data-column]")).toBeNull(); // nothing picked: the overview shows
    const c = await openSettings(user, "mode");
    expect(within(c).getByLabelText("Type")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-column]")).toHaveLength(1);
    await user.click(document.querySelector('[data-nav-column="dist"]') as HTMLElement);
    expect(document.querySelector('[data-column="mode"]')).toBeNull();
    expect(within(card("dist")).getByLabelText("Type")).toBeInTheDocument();
  });

  it("move to the next and the previous column", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    await openSettings(user, "mode");
    expect(screen.getByRole("button", { name: /Previous column/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Next column/ }));
    expect(document.querySelector('[data-column="dist"]')).not.toBeNull();
    await openSettings(user, "email"); // the last one
    expect(screen.getByRole("button", { name: /Next column/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Previous column/ }));
    expect(document.querySelector('[data-column="when"]')).not.toBeNull();
  });
});

describe("type (FR-005, FR-006)", () => {
  it("sends the chosen type to the worker and shows the result", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "mode");
    await user.selectOptions(within(c).getByLabelText("Type"), "integer");
    await waitFor(() => expect(badges("mode")).toContain("Integer"));
    const message = sent.profile.find((m) => m.type === "reprofile");
    expect(message && message.type === "reprofile" && message.overrides).toEqual({ type: "integer" });
  });

  it("says what was detected when the user chose differently", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "mode");
    await user.selectOptions(within(c).getByLabelText("Type"), "float");
    await waitFor(() => expect(within(card("mode")).getByText(/Detected as categorical/)).toBeInTheDocument());
  });

  it("lets a column be marked as not supported, which leaves it out", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "mode");
    await user.selectOptions(within(c).getByLabelText("Type"), "unsupported");
    await waitFor(() => expect(badges("mode")).toContain("Left out"));
    const spec = await generated(user);
    expect(spec.columns.find((x) => x.name === "mode")).toEqual({ name: "mode", type: "unsupported", exclude: "drop" });
  });

  it("offers dates through a pattern, not as a plain choice", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "mode");
    expect(within(c).queryByLabelText("Date or time pattern")).not.toBeInTheDocument();
    await user.selectOptions(within(c).getByLabelText("Type"), "date");
    expect(within(card("mode")).getByLabelText("Date or time pattern")).toBeInTheDocument();
    expect(sent.profile.some((m) => m.type === "reprofile")).toBe(false); // nothing is sent until a pattern is applied
  });

  it("disables the settings while the column is profiled again", async () => {
    scenario.replyDelay = 80;
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "mode");
    await user.selectOptions(within(c).getByLabelText("Type"), "integer");
    expect(card("mode")).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(card("mode")).toHaveAttribute("aria-busy", "false"));
  });

  it("shows a worker problem and keeps the screen usable", async () => {
    scenario.reprofileFails = true;
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "mode");
    await user.selectOptions(within(c).getByLabelText("Type"), "integer");
    expect(await screen.findByRole("alert")).toHaveTextContent(/went wrong/);
    expect(document.querySelectorAll("[data-nav-column]").length).toBe(4);
    expect(card("mode")).toHaveAttribute("aria-busy", "false");
  });
});

describe("sentinel codes (FR-007)", () => {
  it("shows the codes found with their counts", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "dist");
    expect(within(c).getByLabelText("Special answer codes")).toHaveValue("-9");
    expect(within(c).getByText(/-9 \(5 rows\)/)).toBeInTheDocument();
  });

  it("sends the codes the user confirms", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "dist");
    const box = within(c).getByLabelText("Special answer codes");
    await user.clear(box);
    await user.type(box, "-9, 998 , 999");
    await user.click(applyFor(c, "Special answer codes"));
    await waitFor(() => expect(within(card("dist")).getByLabelText("Special answer codes")).toHaveValue("-9, 998, 999"));
    const message = sent.profile.filter((m) => m.type === "reprofile").pop();
    expect(message && message.type === "reprofile" && message.overrides.sentinels).toEqual(["-9", "998", "999"]);
  });

  it("accepts no codes at all", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "dist");
    await user.clear(within(c).getByLabelText("Special answer codes"));
    await user.click(applyFor(c, "Special answer codes"));
    await waitFor(() => expect(sent.profile.some((m) => m.type === "reprofile" && Array.isArray(m.overrides.sentinels) && m.overrides.sentinels.length === 0)).toBe(true));
  });

  it("goes back to the proposed codes", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "dist");
    await user.click(within(c).getByRole("button", { name: "Use the proposed codes" }));
    const message = sent.profile.filter((m) => m.type === "reprofile").pop();
    expect(message && message.type === "reprofile" && "sentinels" in message.overrides).toBe(false);
  });

  it("keeps the confirmed codes in the spec with their exact counts", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "dist");
    const box = within(c).getByLabelText("Special answer codes");
    await user.clear(box);
    await user.type(box, "-1");
    await user.click(applyFor(c, "Special answer codes"));
    await waitFor(() => expect(within(card("dist")).getByText(/Codes kept: -1/)).toBeInTheDocument());
    const spec = await generated(user);
    expect(spec.columns.find((x) => x.name === "dist")).toMatchObject({ sentinels: { "-1": 3 } });
  });
});

describe("missing-value markers (FR-008)", () => {
  it("explain that a blank field always counts as missing", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "mode");
    expect(within(c).getByText(/Blank fields always count as missing/)).toBeInTheDocument();
  });

  it("send the tokens the user lists", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "mode");
    await user.type(within(c).getByLabelText("Words that also mean missing"), "NA, refused");
    await user.click(applyFor(c, "Words that also mean missing"));
    await waitFor(() => expect(within(card("mode")).getByLabelText("Words that also mean missing")).toHaveValue("NA, refused"));
    const message = sent.profile.filter((m) => m.type === "reprofile").pop();
    expect(message && message.type === "reprofile" && message.overrides.naTokens).toEqual(["NA", "refused"]);
  });
});

describe("numeric mode, decimals and rescale (FR-011, FR-027)", () => {
  it("chooses how values are generated, and the spec carries it", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "dist");
    expect(within(c).getByLabelText(/The same average and spread/)).toBeChecked();
    await user.click(within(c).getByLabelText(/The same shape/));
    const spec = await generated(user);
    expect(spec.columns.find((x) => x.name === "dist")).toMatchObject({ mode: "match_shape" });
  });

  it("sets decimal places for a decimal column only", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "dist");
    fireEvent.change(within(c).getByLabelText("Decimal places"), { target: { value: "4" } });
    expect(within(card("dist")).getByLabelText("Decimal places")).toHaveValue(4);
    const spec = await generated(user);
    expect(spec.columns.find((x) => x.name === "dist")).toMatchObject({ decimals: 4 });
  });

  it("does not offer decimal places for an integer column", async () => {
    scenario.profiles = [numeric("n", { type: "integer", detectedType: "integer" })];
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "n");
    expect(within(c).queryByLabelText("Decimal places")).not.toBeInTheDocument();
  });

  it("keeps decimal places inside 0 to 15", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "dist");
    fireEvent.change(within(c).getByLabelText("Decimal places"), { target: { value: "40" } });
    expect(within(card("dist")).getByLabelText("Decimal places")).toHaveValue(15);
  });

  it("offers the rescale only for match mean and spread, and leaves it off by default", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "dist");
    const rescale = within(c).getByLabelText(/Make the average and spread match exactly/);
    expect(rescale).not.toBeChecked();
    expect(rescale).toBeEnabled();
    await user.click(within(c).getByLabelText(/Evenly spread/));
    expect(within(card("dist")).getByLabelText(/Make the average and spread match exactly/)).toBeDisabled();
  });

  it("turns the rescale on and sends it in the spec", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "dist");
    await user.click(within(c).getByLabelText(/Make the average and spread match exactly/));
    const spec = await generated(user);
    expect(spec.columns.find((x) => x.name === "dist")).toMatchObject({ rescale: true });
  });

  it("is also offered for dates and times", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "when");
    expect(within(c).getByLabelText(/The same average and spread/)).toBeInTheDocument();
    expect(within(c).queryByLabelText("Decimal places")).not.toBeInTheDocument();
  });

  it("is not offered for a categorical column", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "mode");
    expect(within(c).queryByLabelText(/The same average and spread/)).not.toBeInTheDocument();
  });
});

describe("leaving a column out (FR-012)", () => {
  it("includes every supported column by default", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "mode");
    expect(within(c).getByLabelText("In the fake file")).toHaveValue("include");
  });

  it("drops a column the user leaves out", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "mode");
    await user.selectOptions(within(c).getByLabelText("In the fake file"), "drop");
    expect(within(card("mode")).getByText("Left out")).toBeInTheDocument();
    const spec = await generated(user);
    expect(spec.columns.find((x) => x.name === "mode")).toMatchObject({ exclude: "drop" });
  });

  it("keeps a column as all-missing when asked", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "mode");
    await user.selectOptions(within(c).getByLabelText("In the fake file"), "keep_as_na");
    expect(within(card("mode")).getByText("Kept as all-missing")).toBeInTheDocument();
    const spec = await generated(user);
    expect(spec.columns.find((x) => x.name === "mode")).toMatchObject({ exclude: "keep_as_na" });
  });

  it("will not include a column that cannot be generated", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "email");
    expect(within(c).getByRole("option", { name: "Include this column" })).toBeDisabled();
    expect(within(c).getByLabelText("In the fake file")).toHaveValue("drop");
  });

  it("brings a left-out column back", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "mode");
    await user.selectOptions(within(c).getByLabelText("In the fake file"), "drop");
    await user.selectOptions(within(card("mode")).getByLabelText("In the fake file"), "include");
    expect(within(card("mode")).queryByText("Left out")).not.toBeInTheDocument();
  });
});

describe("optional protections are off by default (FR-013)", () => {
  it("start off, and leave the spec free of them", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "mode");
    expect(within(c).getByLabelText(/Group very small labels/)).toHaveValue(null);
    expect(within(c).getByLabelText(/Hide label names/)).not.toBeChecked();
    expect(within(c).getByLabelText("Name in the fake file")).toHaveValue("mode");
    const spec = await generated(user);
    const col = spec.columns.find((x) => x.name === "mode") as unknown as Record<string, unknown>;
    expect(col).not.toHaveProperty("merge_under_k");
    expect(col).not.toHaveProperty("label_codes");
    expect(col).not.toHaveProperty("output_name");
  });

  it("merges rare categories when k is set, and stops when it is cleared", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "mode");
    fireEvent.change(within(c).getByLabelText(/Group very small labels/), { target: { value: "10" } });
    let spec = await generated(user);
    expect(spec.columns.find((x) => x.name === "mode")).toMatchObject({ merge_under_k: 10 });
    await user.click(screen.getByRole("button", { name: /Review/ }));
    const reopened = await openSettings(user, "mode"); // going back closes every card's settings
    fireEvent.change(within(reopened).getByLabelText(/Group very small labels/), { target: { value: "" } });
    spec = await generated(user);
    expect(spec.columns.find((x) => x.name === "mode")).not.toHaveProperty("merge_under_k");
  });

  it("replaces labels with neutral codes when asked", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "mode");
    await user.click(within(c).getByLabelText(/Hide label names/));
    const spec = await generated(user);
    expect(spec.columns.find((x) => x.name === "mode")).toMatchObject({ label_codes: true });
  });

  it("does not offer the label protections for a numeric column", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "dist");
    expect(within(c).queryByLabelText(/Merge categories/)).not.toBeInTheDocument();
    expect(within(c).queryByLabelText(/neutral codes/)).not.toBeInTheDocument();
  });

  it("renames a column in the fake file only", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "mode");
    const box = within(c).getByLabelText("Name in the fake file");
    await user.clear(box);
    await user.type(box, "travel_mode");
    await user.click(applyFor(c, "Name in the fake file", "Rename"));
    expect(within(card("mode")).getAllByText(/Written as travel_mode/).length).toBeGreaterThan(0); // under the name, and in the summary of the writing group
    const spec = await generated(user);
    expect(spec.columns.find((x) => x.name === "mode")).toMatchObject({ output_name: "travel_mode" });
  });

  it("rejects a name another column already has, and a blank one", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "mode");
    const box = within(c).getByLabelText("Name in the fake file");
    await user.clear(box);
    await user.type(box, "dist");
    expect(within(c).getByRole("alert")).toHaveTextContent(/already has this name/);
    expect(applyFor(c, "Name in the fake file", "Rename")).toBeDisabled();
    await user.clear(box);
    expect(within(c).getByRole("alert")).toHaveTextContent(/needs a name/);
    expect(applyFor(c, "Name in the fake file", "Rename")).toBeDisabled();
  });
});

describe("the date pattern box (FR-005a)", () => {
  async function dateBox(user: User) {
    await toReview(user);
    const c = await openSettings(user, "when");
    return { c, box: within(c).getByLabelText("Date or time pattern") as HTMLInputElement };
  }

  it("starts with the pattern in effect", async () => {
    const user = userEvent.setup();
    render(<App />);
    const { box } = await dateBox(user);
    expect(box).toHaveValue("%m/%d/%Y");
  });

  it("counts how many values a supported pattern parses, as the user types", async () => {
    const user = userEvent.setup();
    render(<App />);
    const { c, box } = await dateBox(user);
    await user.clear(box);
    await user.type(box, "%d/%m/%Y");
    expect(await screen.findByText(/Parses 40 of 100 values/, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(within(c).getByTestId("date-pattern-status")).toHaveTextContent(/leave this column out/);
    await user.clear(box);
    await user.type(box, "%m/%d/%Y");
    expect(await screen.findByText("Parses all 100 values.", {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it("checks only once the user pauses, not on every key", async () => {
    const user = userEvent.setup();
    render(<App />);
    const { box } = await dateBox(user);
    await user.clear(box);
    await user.type(box, "%Y-%m-%d");
    await screen.findByText(/Parses/, {}, { timeout: 2000 });
    const checks = sent.profile.filter((m) => m.type === "datePattern");
    expect(checks.length).toBeLessThanOrEqual(2);
    expect(checks[checks.length - 1] && checks[checks.length - 1].type === "datePattern" && checks[checks.length - 1].pattern).toBe("%Y-%m-%d");
  });

  it("rejects an unsupported directive without asking the worker", async () => {
    const user = userEvent.setup();
    render(<App />);
    const { c, box } = await dateBox(user);
    await user.clear(box);
    await user.type(box, "%Y-%m-%d %Z");
    expect(within(c).getByRole("alert")).toHaveTextContent(/not supported/);
    expect(applyFor(c, "Date or time pattern", "Use this pattern")).toBeDisabled();
    await new Promise((r) => setTimeout(r, 450));
    expect(sent.profile.some((m) => m.type === "datePattern")).toBe(false);
  });

  it("sends the pattern when applied, and the column follows the result", async () => {
    const user = userEvent.setup();
    render(<App />);
    const { c, box } = await dateBox(user);
    await user.clear(box);
    await user.type(box, "%d/%m/%Y");
    await user.click(applyFor(c, "Date or time pattern", "Use this pattern"));
    await waitFor(() => expect(badges("when")).toContain("Unsupported in this version"));
    const message = sent.profile.filter((m) => m.type === "reprofile").pop();
    expect(message && message.type === "reprofile" && message.overrides.datePattern).toBe("%d/%m/%Y");
    expect(within(card("when")).getByText("Left out")).toBeInTheDocument();
  });

  it("keeps a column a date when the pattern parses every value", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await openSettings(user, "when");
    const box = within(c).getByLabelText("Date or time pattern");
    await user.clear(box);
    await user.type(box, "%m/%d/%y");
    await user.clear(box);
    await user.type(box, "%m/%d/%Y");
    await user.click(applyFor(c, "Date or time pattern", "Use this pattern"));
    await waitFor(() => expect(badges("when")).toContain("Date"));
  });
});

describe("a change survives profiling again", () => {
  it("keeps local edits and sends the engine-side ones with the new limit (FR-006)", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);

    const c = await openSettings(user, "dist");
    fireEvent.change(within(c).getByLabelText("Decimal places"), { target: { value: "5" } });
    const sentinels = within(c).getByLabelText("Special answer codes");
    await user.clear(sentinels);
    await user.type(sentinels, "-1");
    await user.click(applyFor(c, "Special answer codes"));
    await waitFor(() => expect(within(card("dist")).getByText(/Codes kept: -1/)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Overview" })); // the limit lives in the overview
    const limit = screen.getByLabelText(/up to this many distinct values/);
    await user.clear(limit);
    await user.type(limit, "80");
    await user.click(applyFor(screen.getByRole("region", { name: "Review columns" }), /up to this many distinct values/, "Profile again"));

    await waitFor(() => expect(sent.profile.filter((m) => m.type === "profile").length).toBe(2));
    const again = sent.profile.filter((m) => m.type === "profile").pop();
    expect(again && again.type === "profile" && again.threshold).toBe(80);
    expect(again && again.type === "profile" && again.overrides?.dist).toEqual({ sentinels: ["-1"] });

    await waitFor(() => expect(screen.getByRole("button", { name: "Continue to Generate" })).toBeEnabled());
    expect(within(card("dist")).getByText(/Codes kept: -1/)).toBeInTheDocument();
    const spec = await generated(user);
    expect(spec.columns.find((x) => x.name === "dist")).toMatchObject({ decimals: 5, sentinels: { "-1": 3 } });
    expect(spec.categorical_threshold).toBe(80);
  });

  it("rejects a limit that is not a whole number from 2 to 2,000", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const region = screen.getByRole("region", { name: "Review columns" });
    const limit = within(region).getByLabelText(/up to this many distinct values/);
    for (const bad of ["", "1", "abc", "2001", "3.5"]) {
      await user.clear(limit);
      if (bad) await user.type(limit, bad);
      expect(within(region).getByRole("alert")).toHaveTextContent(/whole number from 2 to 2,000/);
      expect(applyFor(region, /up to this many distinct values/, "Profile again")).toBeDisabled();
    }
  });
});

describe("the spec notice (FR-038)", () => {
  it("tells the user what the spec contains, on the Review screen", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole("note", { name: "What the spec contains" })).not.toBeInTheDocument();
    await toReview(user);
    const notice = screen.getByRole("note", { name: "What the spec contains" });
    expect(notice).toHaveTextContent(/real category labels/);
    expect(notice).toHaveTextContent(/exact minimum and maximum/);
    expect(notice).toHaveTextContent(/sentinel codes/);
    expect(notice).toHaveTextContent(/only counts, lengths, patterns and the kind of data, never a value/);
    expect(notice).toHaveTextContent(/no rows, no ID lists, no words/);
  });

  it("stays visible while the user edits and filters", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    await user.type(screen.getByLabelText("Search columns"), "mode");
    expect(screen.getByRole("note", { name: "What the spec contains" })).toBeInTheDocument();
  });
});
