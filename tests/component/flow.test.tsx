// The ingest, review and generate flow with mocked workers that follow the real message protocol
// (contracts/worker-protocol.md). Checks what the screens show and do, not the workers themselves
// (those are covered by the integration and browser tests).

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import type { ColumnProfile, FileSettings } from "../../src/lib/profile/types";
import type { GenerateRequest, GenerateResponse, ProfileRequest, ProfileResponse } from "../../src/workers/protocol";

const settings: FileSettings = {
  encoding: "utf-8",
  bom: false,
  delimiter: ",",
  quote: '"',
  quoteStyle: "minimal",
  lineEnding: "lf",
  header: true,
  headerQuoted: false,
  trailingNewline: true,
};

const hist = Array.from({ length: 20 }, (_, i) => i + 1);
const base = { outputName: "", naTokens: [] as string[], naCount: 0, naByToken: {}, sentinels: {}, exclude: "include" as const, quoted: false, attentionReasons: [] };
const profiles: ColumnProfile[] = [
  { ...base, name: "mode", outputName: "mode", detectedType: "categorical", type: "categorical", status: "ok", summary: { kind: "categorical", storage: "integer", counts: { "1": 60, "2": 40 } } },
  {
    ...base,
    name: "dist",
    outputName: "dist",
    detectedType: "float",
    type: "float",
    status: "needs_attention",
    attentionReasons: ["possible_sentinel"],
    sentinels: { "-9": 5 },
    summary: { kind: "numeric", min: 0.5, max: 9.5, mean: 4, sd: 2, decimals: 1, quantiles: Array.from({ length: 101 }, (_, i) => 0.5 + i * 0.09), histogram: hist },
  },
  { ...base, name: "email", outputName: "email", detectedType: "unsupported", type: "unsupported", status: "unsupported", exclude: "drop", attentionReasons: ["unsupported_type", "possible_identifier"], summary: { kind: "unsupported" } },
];

let profileMode: "ok" | "error" = "ok";
let generateMode: "ok" | "error" = "ok";
const sent: { profile: ProfileRequest[]; generate: GenerateRequest[] } = { profile: [], generate: [] };

class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly kind: "profile" | "generate";

  constructor(url: URL) {
    this.kind = String(url).includes("generate") ? "generate" : "profile";
  }

  private reply(data: ProfileResponse | GenerateResponse) {
    setTimeout(() => this.onmessage?.({ data }), 0);
  }

  postMessage(message: ProfileRequest | GenerateRequest) {
    if (this.kind === "profile") {
      const m = message as ProfileRequest;
      sent.profile.push(m);
      if (m.type === "open") {
        if (profileMode === "error") return this.reply({ type: "error", error: { code: "csv_parse_error", message: "The file could not be read as CSV near row 3. Check the delimiter, quote and header settings." } });
        this.reply({ type: "settingsDetected", settings, confidence: "high", columnNames: ["mode", "dist", "email"], fileName: m.file.name, fileSize: 1024 });
      } else if (m.type === "load") {
        this.reply({ type: "loaded", rowCount: 100, columnNames: ["mode", "dist", "email"], settings: m.settings });
      } else if (m.type === "profile") {
        for (const profile of profiles) this.reply({ type: "columnProfile", profile });
        this.reply({ type: "profiled", count: profiles.length });
      }
    } else {
      const m = message as GenerateRequest;
      sent.generate.push(m);
      if (m.type !== "generate") return;
      if (generateMode === "error") return this.reply({ type: "error", error: { code: "generation_error", message: "The table could not be generated from this spec." } });
      this.reply({ type: "preview", header: ["mode", "dist"], rows: [["1", "3.2"], ["2", "-9"]] });
      this.reply({ type: "chunk", bytes: new TextEncoder().encode("mode,dist\n1,3.2\n").buffer as ArrayBuffer });
      this.reply({ type: "progress", rowsDone: 100, rowsTotal: 100 });
      this.reply({
        type: "checks",
        checks: [
          { column: "mode", metric: "label_counts", target: "{}", achieved: "{}", pass: true },
          { column: "dist", metric: "min", target: "0.5", achieved: "0.5", pass: true },
        ],
      });
      this.reply({ type: "done", totalBytes: 1024, replaced: 0 });
    }
  }

  terminate() {}
}

beforeEach(() => {
  profileMode = "ok";
  generateMode = "ok";
  sent.profile = [];
  sent.generate = [];
  vi.stubGlobal("Worker", FakeWorker);
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  // jsdom cannot navigate, so a clicked download link would only log an error.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const file = () => new File(["mode,dist,email\n1,2,a@b.c\n"], "trips.csv", { type: "text/csv" });

async function toReview(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText("CSV file"), file());
  await user.click(await screen.findByRole("button", { name: /profile this file/i }));
  await screen.findByRole("heading", { name: "Review columns" });
}

describe("ingest", () => {
  it("starts on the file picker with the privacy notice and stepper", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Choose a file" })).toBeInTheDocument();
    expect(screen.getByRole("note", { name: "Privacy" })).toHaveTextContent(/never uploaded/);
    expect(screen.getByRole("button", { name: /Review/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Generate/ })).toBeDisabled();
  });

  it("shows the detected settings and the column names, never a row", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.upload(screen.getByLabelText("CSV file"), file());
    expect(await screen.findByRole("heading", { name: "Detected settings" })).toBeInTheDocument();
    expect(screen.getByLabelText("Delimiter")).toHaveValue(",");
    expect(screen.getByLabelText("Encoding")).toHaveValue("utf-8");
    expect(screen.getByLabelText(/First row is a header/)).toBeChecked();
    expect(screen.getByText("3 column names")).toBeInTheDocument();
    expect(screen.queryByText("a@b.c")).not.toBeInTheDocument();
  });

  it("sends the settings the user edited", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.upload(screen.getByLabelText("CSV file"), file());
    await user.selectOptions(await screen.findByLabelText("Delimiter"), ";");
    await user.click(screen.getByRole("button", { name: /profile this file/i }));
    await screen.findByRole("heading", { name: "Review columns" });
    const load = sent.profile.find((m) => m.type === "load");
    expect(load && load.type === "load" && load.settings.delimiter).toBe(";");
  });

  it("shows a worker error as a clear message", async () => {
    profileMode = "error";
    const user = userEvent.setup();
    render(<App />);
    await user.upload(screen.getByLabelText("CSV file"), file());
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be read as CSV");
  });
});

describe("review", () => {
  it("shows a card per column with type, status and facts", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const cards = document.querySelectorAll(".column-card");
    expect(cards).toHaveLength(3);
    const modeCard = document.querySelector('[data-column="mode"]') as HTMLElement;
    expect(within(modeCard).getByText("Categorical")).toBeInTheDocument();
    expect(within(modeCard).getByText(/1: 60/)).toBeInTheDocument();
    const dist = document.querySelector('[data-column="dist"]') as HTMLElement;
    expect(within(dist).getByText("Needs attention")).toBeInTheDocument();
    expect(within(dist).getByText(/Codes kept: -9 \(5\)/)).toBeInTheDocument();
  });

  it("marks unsupported columns as left out and explains why", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    const email = document.querySelector('[data-column="email"]') as HTMLElement;
    expect(within(email).getByText("Left out")).toBeInTheDocument();
    expect(within(email).getByText(/personal data/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/2 columns need a look; 1 will be left out/);
  });

  it("draws a chart for columns that have a distribution", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    expect(screen.getByRole("img", { name: "Distribution of dist" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Distribution of email" })).not.toBeInTheDocument();
  });
});

describe("generate", () => {
  async function toGenerate(user: ReturnType<typeof userEvent.setup>) {
    await toReview(user);
    await user.click(screen.getByRole("button", { name: "Continue to Generate" }));
    return screen.getByRole("region", { name: "Generate the fake table" });
  }

  it("generates, shows the check table and the 50-row preview, and offers downloads", async () => {
    const user = userEvent.setup();
    render(<App />);
    const region = await toGenerate(user);
    await user.click(within(region).getByRole("button", { name: "Generate" }));
    expect(await screen.findByText(/All 2 checks passed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download trips_fake\.csv/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download spec/ })).toBeInTheDocument();
    expect(screen.getByText(/Preview of the first 2 fake rows/)).toBeInTheDocument();
    expect(sent.generate[0].type === "generate" && sent.generate[0].seed).toBe(42);
  });

  it("sends a spec that leaves out the unsupported column", async () => {
    const user = userEvent.setup();
    render(<App />);
    const region = await toGenerate(user);
    await user.click(within(region).getByRole("button", { name: "Generate" }));
    await screen.findByText(/All 2 checks passed/);
    const request = sent.generate[0];
    if (request.type !== "generate") throw new Error("expected a generate request");
    const email = request.spec.columns.find((c) => c.name === "email");
    expect(email).toEqual({ name: "email", type: "unsupported", exclude: "drop" });
    expect(JSON.stringify(request.spec)).not.toContain("a@b.c");
  });

  it("rejects a blank or out-of-range seed and disables Generate", async () => {
    const user = userEvent.setup();
    render(<App />);
    const region = await toGenerate(user);
    const seed = within(region).getByLabelText("Seed");
    for (const bad of ["", "abc", "-1", "4294967296", "1.5"]) {
      await user.clear(seed);
      if (bad) await user.type(seed, bad);
      expect(within(region).getByRole("button", { name: "Generate" })).toBeDisabled();
      expect(within(region).getByRole("alert")).toHaveTextContent(/whole number from 0 to 4,294,967,295/);
    }
    await user.clear(seed);
    await user.type(seed, "4294967295");
    expect(within(region).getByRole("button", { name: "Generate" })).toBeEnabled();
  });

  it("uses the seed the user typed", async () => {
    const user = userEvent.setup();
    render(<App />);
    const region = await toGenerate(user);
    const seed = within(region).getByLabelText("Seed");
    await user.clear(seed);
    await user.type(seed, "7");
    await user.click(within(region).getByRole("button", { name: "Generate" }));
    await screen.findByText(/checks passed/);
    const request = sent.generate[0];
    expect(request.type === "generate" && request.seed).toBe(7);
  });

  it("names the export with _fake by default and keeps the name on request", async () => {
    const user = userEvent.setup();
    render(<App />);
    const region = await toGenerate(user);
    await user.click(within(region).getByRole("button", { name: "Generate" }));
    await screen.findByRole("button", { name: /Download trips_fake\.csv/ });
    await user.click(within(region).getByLabelText(/Keep the original file name/));
    expect(await screen.findByRole("button", { name: /Download trips\.csv/ })).toBeInTheDocument();
  });

  it("downloads the fake file from the received chunks", async () => {
    const user = userEvent.setup();
    render(<App />);
    const region = await toGenerate(user);
    await user.click(within(region).getByRole("button", { name: "Generate" }));
    await user.click(await screen.findByRole("button", { name: /Download trips_fake\.csv/ }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    // jsdom's Blob has no text(), so read it back with a FileReader.
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(text).toBe("mode,dist\n1,3.2\n");
  });

  it("shows a generation error clearly", async () => {
    generateMode = "error";
    const user = userEvent.setup();
    render(<App />);
    const region = await toGenerate(user);
    await user.click(within(region).getByRole("button", { name: "Generate" }));
    expect(await screen.findByText("The table could not be generated from this spec.")).toBeInTheDocument();
  });
});

describe("navigation", () => {
  it("lets the user go back to an earlier step and keeps the profiled data", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    await user.click(screen.getByRole("button", { name: /Ingest/ }));
    expect(screen.getByRole("heading", { name: "Choose a file" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Review/ }));
    expect(document.querySelectorAll(".column-card")).toHaveLength(3);
  });

  it("starts over, clearing the data and returning to the first step", async () => {
    const user = userEvent.setup();
    render(<App />);
    await toReview(user);
    await user.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByRole("heading", { name: "Choose a file" })).toBeInTheDocument();
    expect(screen.queryByText("Detected settings")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Review/ })).toBeDisabled();
  });
});
