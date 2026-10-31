// Mock workers for component tests. They follow the real message protocol (contracts/worker-protocol.md)
// and let a test choose which profiles come back and how a column re-profiles after a change.

import { vi } from "vitest";
import type { ColumnOverrides, ColumnProfile, FileSettings } from "../../src/lib/profile/types";
import type { GenerateRequest, GenerateResponse, ProfileRequest, ProfileResponse } from "../../src/workers/protocol";

export const settings: FileSettings = {
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

const base = { naTokens: [] as string[], naCount: 0, naByToken: {}, sentinels: {}, exclude: "include" as const, quoted: false, attentionReasons: [] as ColumnProfile["attentionReasons"] };
const hist = Array.from({ length: 20 }, (_, i) => i + 1);

export const categorical = (name: string, over: Partial<ColumnProfile> = {}): ColumnProfile => ({
  ...base,
  name,
  outputName: name,
  detectedType: "categorical",
  type: "categorical",
  status: "ok",
  summary: { kind: "categorical", storage: "integer", counts: { "1": 60, "2": 30, "3": 6, "4": 4 } },
  ...over,
});

export const numeric = (name: string, over: Partial<ColumnProfile> = {}): ColumnProfile => ({
  ...base,
  name,
  outputName: name,
  detectedType: "float",
  type: "float",
  status: "ok",
  mode: "match_mean_sd",
  summary: { kind: "numeric", min: 0.5, max: 9.5, mean: 4, sd: 2, decimals: 2, quantiles: Array.from({ length: 101 }, (_, i) => 0.5 + i * 0.09), histogram: hist },
  ...over,
});

/** A whole-number ID column of five digits whose repeat structure needs `groups` distinct IDs. */
export const idColumn = (name: string, over: Partial<ColumnProfile> = {}, groups = 500): ColumnProfile => ({
  ...base,
  name,
  outputName: name,
  detectedType: "survey_id",
  type: "survey_id",
  status: "ok",
  summary: { kind: "survey_id", mask: ["digit", "digit", "digit", "digit", "digit"], min: 10000, max: 10000 + groups - 1, padWidth: 0, repeatStructure: { "1": groups / 2, "2": groups / 4, "4": groups / 4 }, distinct: groups },
  ...over,
});

export const unsupportedColumn = (name: string): ColumnProfile => ({
  ...base,
  name,
  outputName: name,
  detectedType: "unsupported",
  type: "unsupported",
  status: "unsupported",
  exclude: "drop",
  attentionReasons: ["unsupported_type", "possible_identifier"],
  summary: { kind: "unsupported" },
});

export const dateColumn = (name: string, over: Partial<ColumnProfile> = {}): ColumnProfile => ({
  ...base,
  name,
  outputName: name,
  detectedType: "date",
  type: "date",
  status: "ok",
  mode: "match_mean_sd",
  summary: { kind: "datetime", format: "%m/%d/%Y", granularity: "day", min: 17000, max: 19000, mean: 18000, sd: 500, decimals: 0, quantiles: Array.from({ length: 101 }, (_, i) => 17000 + i * 20), histogram: hist },
  ...over,
});

export interface Scenario {
  profiles: ColumnProfile[];
  /** How a column looks after the worker profiles it again with these settings. */
  reprofile: (current: ColumnProfile, overrides: ColumnOverrides) => ColumnProfile;
  /** What a typed date pattern parses: [parsed, total]. */
  dateCounts: (pattern: string) => [number, number];
  profileFails: boolean;
  reprofileFails: boolean;
  generateFails: boolean;
  /** Milliseconds before the profile worker answers a re-profile. */
  replyDelay: number;
}

/** Applies the overrides the way the real worker would, in the simplest way that still shows them. */
export const defaultReprofile: Scenario["reprofile"] = (p, o) => {
  const out: ColumnProfile = { ...p, attentionReasons: [...p.attentionReasons] };
  if (o.sentinels) {
    out.sentinels = Object.fromEntries(o.sentinels.map((s) => [s, 3]));
    out.attentionReasons = out.attentionReasons.filter((r) => r !== "possible_sentinel");
  }
  if (o.naTokens) {
    out.naTokens = ["", ...o.naTokens];
    out.naByToken = Object.fromEntries(out.naTokens.map((t) => [t, 2]));
    out.naCount = out.naTokens.length * 2;
  }
  if (o.type) {
    out.type = o.type;
    if (o.type === "integer" || o.type === "float") out.summary = numeric(p.name).summary;
    if (o.type === "unsupported") {
      out.summary = { kind: "unsupported" };
      out.exclude = "drop";
      out.status = "unsupported";
    }
  }
  if (o.datePattern) {
    const parsesAll = o.datePattern === "%m/%d/%Y";
    out.type = parsesAll ? "date" : "unsupported";
    out.status = parsesAll ? "ok" : "unsupported";
    out.summary = parsesAll ? dateColumn(p.name).summary : { kind: "unsupported" };
    out.exclude = parsesAll ? "include" : "drop";
  }
  return out;
};

export const scenario: Scenario = {
  profiles: [],
  reprofile: defaultReprofile,
  dateCounts: (pattern) => (pattern === "%m/%d/%Y" ? [100, 100] : [40, 100]),
  profileFails: false,
  reprofileFails: false,
  generateFails: false,
  replyDelay: 0,
};

export const sent: { profile: ProfileRequest[]; generate: GenerateRequest[] } = { profile: [], generate: [] };

export function resetScenario(profiles: ColumnProfile[]): void {
  scenario.profiles = profiles;
  scenario.reprofile = defaultReprofile;
  scenario.dateCounts = (pattern) => (pattern === "%m/%d/%Y" ? [100, 100] : [40, 100]);
  scenario.profileFails = false;
  scenario.reprofileFails = false;
  scenario.generateFails = false;
  scenario.replyDelay = 0;
  sent.profile = [];
  sent.generate = [];
}

class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly kind: "profile" | "generate";
  private overrides: Record<string, ColumnOverrides> = {};

  constructor(url: URL) {
    this.kind = String(url).includes("generate") ? "generate" : "profile";
  }

  private reply(data: ProfileResponse | GenerateResponse) {
    setTimeout(() => this.onmessage?.({ data }), scenario.replyDelay);
  }

  postMessage(message: ProfileRequest | GenerateRequest) {
    if (this.kind === "profile") this.profileMessage(message as ProfileRequest);
    else this.generateMessage(message as GenerateRequest);
  }

  private profileMessage(m: ProfileRequest) {
    sent.profile.push(m);
    const names = scenario.profiles.map((p) => p.name);
    switch (m.type) {
      case "open":
        this.reply({ type: "settingsDetected", settings, confidence: "high", columnNames: names, fileName: m.file.name, fileSize: 1024 });
        break;
      case "load":
        this.reply({ type: "loaded", rowCount: 100, columnNames: names, settings: m.settings });
        break;
      case "profile":
        this.overrides = m.overrides ?? {};
        if (scenario.profileFails && Object.keys(this.overrides).length > 0) {
          return this.reply({ type: "error", error: { code: "engine_error", message: "Something went wrong while processing the file." } });
        }
        for (const p of scenario.profiles) {
          const o = this.overrides[p.name];
          this.reply({ type: "columnProfile", profile: o ? scenario.reprofile(p, o) : p });
        }
        this.reply({ type: "profiled", count: scenario.profiles.length });
        break;
      case "reprofile": {
        if (scenario.reprofileFails) return this.reply({ type: "error", error: { code: "engine_error", message: "Something went wrong while processing the file." } });
        const current = scenario.profiles.find((p) => p.name === m.column);
        if (current) this.reply({ type: "columnProfile", profile: scenario.reprofile(current, m.overrides) });
        break;
      }
      case "datePattern": {
        const [parsed, total] = scenario.dateCounts(m.pattern);
        this.reply({ type: "datePatternResult", column: m.column, parsed, total });
        break;
      }
      default:
        break;
    }
  }

  private generateMessage(m: GenerateRequest) {
    sent.generate.push(m);
    if (m.type !== "generate") return;
    if (scenario.generateFails) return this.reply({ type: "error", error: { code: "generation_error", message: "The table could not be generated from this spec." } });
    this.reply({ type: "preview", header: ["mode"], rows: [["1"]] });
    this.reply({ type: "chunk", bytes: new TextEncoder().encode("mode\n1\n").buffer as ArrayBuffer });
    this.reply({ type: "progress", rowsDone: 100, rowsTotal: 100 });
    this.reply({ type: "checks", checks: [{ column: "mode", metric: "label_counts", target: "{}", achieved: "{}", pass: true }] });
    this.reply({ type: "done", totalBytes: 8, replaced: 0 });
  }

  terminate() {}
}

/** Installs the mock workers and the browser bits jsdom lacks. Call from beforeEach. */
export function installFakeWorkers(): void {
  vi.stubGlobal("Worker", FakeWorker);
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
}

/** The spec sent with the latest generate request. */
export function lastSpec() {
  const request = [...sent.generate].reverse().find((r) => r.type === "generate");
  if (!request || request.type !== "generate") throw new Error("no generate request was sent");
  return request.spec;
}
