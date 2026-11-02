// What the fake table keeps of the real one (specs/032): a preset for the whole table, then choices per column, in plain words.
// Mock workers follow the real protocol; the spec sent to the generate worker shows what a choice finally does.

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import { categorical, installFakeWorkers, lastSpec, numeric, resetScenario } from "../helpers/fakeWorkers";

type User = ReturnType<typeof userEvent.setup>;

// 100 rows: 96 with a value in the category column (counts 57+29+6+4) plus 4 missing.
const profiles = () => [
  categorical("zone", { naTokens: [""], naCount: 4, naByToken: { "": 4 }, summary: { kind: "categorical", storage: "integer", counts: { "1": 57, "2": 29, "3": 6, "4": 4 } } }),
  numeric("income", { summary: { kind: "numeric", min: 12_345, max: 987_654, mean: 400_000, sd: 200_000, decimals: 0, quantiles: Array.from({ length: 101 }, (_, i) => 12_345 + i * 9_753), histogram: Array.from({ length: 20 }, () => 5) }, type: "integer", detectedType: "integer" }),
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

async function toReview(user: User) {
  await user.upload(screen.getByLabelText("Data file"), new File(["zone,income\n1,2\n"], "t.csv", { type: "text/csv" }));
  await user.click(await screen.findByRole("button", { name: /profile this file/i }));
  await screen.findByRole("heading", { name: "Review columns" });
}

async function pick(user: User, name: string) {
  await user.click(document.querySelector(`[data-nav-column="${name}"]`) as HTMLElement);
  return document.querySelector(`[data-column="${name}"]`) as HTMLElement;
}

async function generated(user: User) {
  await user.click(screen.getByRole("button", { name: "Continue to Generate" }));
  const region = screen.getByRole("region", { name: "Generate the fake table" });
  await user.click(within(region).getByRole("button", { name: /^Generate( again)?$/ }));
  await screen.findByText(/checks passed/);
  return lastSpec();
}

const col = (spec: Awaited<ReturnType<typeof generated>>, name: string) => spec.columns.find((c) => c.name === name) as unknown as Record<string, unknown>;
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe("the preset", () => {
  it("starts on Balanced, a sensible default rather than everything exact", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    expect(screen.getByRole("radio", { name: "Balanced" })).toBeChecked();
    const c = await pick(user, "zone");
    expect(within(c).getByLabelText(/Roughly/)).toBeChecked();
    const spec = await generated(user);
    expect(col(spec, "zone").keep).toMatchObject({ counts: "rounded", missing: "rounded" });
    expect(col(spec, "income").keep).toMatchObject({ range: "rounded" });
    expect(col(spec, "income")).toMatchObject({ min: 12_000, max: 990_000 });
  });

  it("Match closely keeps every real figure", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    await user.click(screen.getByRole("radio", { name: "Match closely" }));
    const c = await pick(user, "zone");
    expect(within(c).getByLabelText(/Exactly as in the real data/)).toBeChecked();
    const spec = await generated(user);
    expect(col(spec, "zone").counts).toEqual({ "1": 57, "2": 29, "3": 6, "4": 4 });
    expect(col(spec, "income")).toMatchObject({ min: 12_345, max: 987_654, mode: "match_shape" });
  });

  it("Most private gives labels equal shares, spreads numbers evenly and leaves out missing values", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    await user.click(screen.getByRole("radio", { name: "Most private" }));
    const spec = await generated(user);
    const zone = col(spec, "zone") as { counts: Record<string, number>; na?: unknown };
    expect(sum(zone.counts)).toBe(100);
    expect(Math.max(...Object.values(zone.counts)) - Math.min(...Object.values(zone.counts))).toBeLessThanOrEqual(1);
    expect(zone.na).toBeUndefined();
    expect(col(spec, "income")).toMatchObject({ mode: "uniform" });
  });
});

describe("choices on one column", () => {
  it("change only that column, and the bar then reads Custom", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await pick(user, "zone");
    await user.click(within(c).getByLabelText(/Equally/));
    expect(screen.getByTestId("preset-custom")).toBeInTheDocument();
    const spec = await generated(user);
    const zone = col(spec, "zone") as { counts: Record<string, number>; na?: { count: number } };
    expect(Math.max(...Object.values(zone.counts)) - Math.min(...Object.values(zone.counts))).toBeLessThanOrEqual(1);
    expect(sum(zone.counts) + (zone.na?.count ?? 0)).toBe(100);
    expect(col(spec, "income").keep).toMatchObject({ range: "rounded" });
  });

  it("show what each choice gives away, and the rounded range before it is chosen", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await pick(user, "income");
    expect(within(c).getByText(/Reveals both extremes/)).toBeInTheDocument();
    expect(within(c).getByText(/12,000 to 990,000/)).toBeInTheDocument();
  });

  it("keep the rarely needed settings under Advanced", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const c = await pick(user, "zone");
    const advanced = within(c).getByTestId("advanced-settings");
    expect(advanced).toHaveTextContent("Optional protections");
    expect(within(advanced).getByLabelText(/New column name|Rename/i, { selector: "input" })).toBeInTheDocument();
    expect(within(c).getByTestId("keep-panel")).not.toContainElement(advanced);
  });
});
