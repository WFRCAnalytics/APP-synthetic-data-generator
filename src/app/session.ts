// Coordinates the two workers and holds everything the screens show. Real data never passes
// through here: the profile worker posts summaries only, and the generated CSV arrives as bytes of
// fake data. Nothing is written to browser storage, so a reload clears it all (Principle I).

import type { CheckRow } from "../lib/generate/checks";
import { applyAllEdits, type LocalEdits } from "../lib/profile/edits";
import {
  isExcelSettings,
  isJsonSettings,
  isParquetSettings,
  type ColumnOverrides,
  type ColumnProfile,
  type FileSettings,
  type SourceSettings,
} from "../lib/profile/types";
import { buildSpec } from "../lib/spec/build";
import { profilesFromSpec, settingsFromSource } from "../lib/spec/toProfiles";
import type { SpecFile, SpecProblem } from "../lib/spec/types";
import type { SampleDescription } from "../lib/textgen/sample";
import type { SheetHints, WorkbookInfo } from "../lib/xlsx/metadata";
import type { JsonSummary, ParquetSummary } from "../workers/protocol";
import { readSpecFile } from "../features/spec/loadSpec";
import { agentReadme, readmeFileNameFor } from "../lib/readme/agentReadme";
import type { RuleSpec } from "../lib/rules/types";
import { validateSpec } from "../lib/spec/validate";
import { APP_VERSION } from "./version";
import { specBlobOf, specFileNameFor } from "../features/spec/saveSpec";
import type {
  GenerateRequest,
  GenerateResponse,
  ProfileJob,
  ProfileRequest,
  ProfileResponse,
} from "../workers/protocol";

export type Phase =
  | "idle"
  | "opening"
  | "opened"
  | "workbook"
  | "parquet"
  | "json"
  | "loading"
  | "profiling"
  | "profiled"
  | "error";

export interface Progress {
  job: ProfileJob | "generate";
  done: number;
  total: number;
}

export interface GenState {
  status: "idle" | "running" | "done" | "error" | "cancelled";
  progress: Progress | null;
  header: string[];
  preview: string[][];
  checks: CheckRow[];
  error: string | null;
  totalBytes: number;
  /** Characters the file's encoding could not write, written as "?". */
  replaced: number;
  /** For a Parquet file: how its pages were compressed. */
  codec?: "gzip" | "none";
}

/** What a typed date pattern parsed, shown beside the pattern box before it is applied. */
export interface DatePatternCheck {
  pattern: string;
  /** Null while the worker is still counting. */
  parsed: number | null;
  total: number | null;
}

/** What the load dialog knows about a chosen workbook: sheet names and flags, and hints per sheet. No cell value. */
export interface WorkbookState {
  info: WorkbookInfo;
  hints: Record<string, SheetHints>;
}

/** What the user confirmed in the load dialog. */
export interface WorkbookChoice {
  sheet: string;
  range?: string;
  skipRows: number;
  header: boolean;
}

export interface SessionState {
  phase: Phase;
  /** Set when the chosen file is a workbook, until it has been loaded. */
  workbook: WorkbookState | null;
  /** Set when the chosen file is a Parquet file: its structure, never a value or any of its metadata text. */
  parquet: ParquetSummary | null;
  /** Set when the chosen file is a JSON file: its structure, never a value or a nested key name. */
  json: JsonSummary | null;
  error: string | null;
  fileName: string;
  fileSize: number;
  settings: SourceSettings | null;
  confidence: "high" | "medium" | "low";
  /** Names only, as detected or re-derived from the settings. */
  columnNames: string[];
  rowCount: number;
  progress: Progress | null;
  profiles: ColumnProfile[];
  threshold: number;
  /** Columns being profiled again after a change. */
  busy: string[];
  /** A problem with the last change on Review (the screen stays usable). */
  reviewError: string | null;
  datePatternChecks: Record<string, DatePatternCheck>;
  seedText: string;
  /** Relations between columns that the person stated (specs/015). */
  rules: RuleSpec[];
  keepOriginalName: boolean;
  gen: GenState;
  /** Columns came from a saved spec: there is no source file, so nothing can be profiled again. */
  specOnly: boolean;
  /** The table was designed in this app (Start from scratch), so there never was a source file. */
  designed: boolean;
  /** Problems found in the last spec file the user tried to load, by column. */
  specProblems: SpecProblem[] | null;
  /** Invented sample values for the cards that show them, by column name. */
  samples: Record<string, string[]>;
}

const emptyGen: GenState = {
  status: "idle",
  progress: null,
  header: [],
  preview: [],
  checks: [],
  error: null,
  totalBytes: 0,
  replaced: 0,
};

export const initialSession: SessionState = {
  phase: "idle",
  workbook: null,
  parquet: null,
  json: null,
  error: null,
  fileName: "",
  fileSize: 0,
  settings: null,
  confidence: "high",
  columnNames: [],
  rowCount: 0,
  progress: null,
  profiles: [],
  threshold: 50,
  busy: [],
  reviewError: null,
  datePatternChecks: {},
  seedText: "42",
  rules: [],
  keepOriginalName: false,
  gen: emptyGen,
  specOnly: false,
  designed: false,
  specProblems: null,
  samples: {},
};

export const MAX_SEED = 4294967295;
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const PARQUET_MIME = "application/vnd.apache.parquet";
export const JSON_MIME = "application/json";
export const NDJSON_MIME = "application/x-ndjson";

/** A valid seed (0 to 4,294,967,295), or null for blank, fractional or out-of-range text. */
export function parseSeed(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n <= MAX_SEED ? n : null;
}

/** The name the export gets: the original with "_fake" before the extension, unless kept. */
export function exportName(fileName: string, keepOriginal: boolean): string {
  if (keepOriginal) return fileName;
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? `${fileName.slice(0, dot)}_fake${fileName.slice(dot)}` : `${fileName}_fake`;
}

type Listener = (state: SessionState) => void;

export class Session {
  state: SessionState = initialSession;
  private listeners = new Set<Listener>();
  private profileWorker: Worker | null = null;
  private generateWorker: Worker | null = null;
  private parts: Uint8Array[] = [];
  private pending = new Map<string, ColumnProfile>();
  /** Makes the invented sample values for Review cards; created on first use, never sees real data. */
  private sampleWorker: Worker | null = null;
  private sampleSeq = 0;
  /** Request id to column name, so a late reply for an older request is ignored. */
  private sampleRequests = new Map<number, string>();
  private sampleLatest = new Map<string, number>();
  /** What the worker last reported for each column, before the user's local edits. */
  private base: ColumnProfile[] = [];
  /** Settings that need no data (leave out, mode, decimals, protections, rename). */
  private edits: Record<string, LocalEdits> = {};
  /** Settings the worker applies when it profiles a column (sentinels, NA tokens, type, date pattern). */
  private engine: Record<string, ColumnOverrides> = {};
  onProfiled: (columns: { name: string; type: string }[]) => void = () => {};
  onSpecLoaded: (columns: { name: string; type: string }[], designed: boolean) => void = () => {};

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }

  private setGen(patch: Partial<GenState>): void {
    this.set({ gen: { ...this.state.gen, ...patch } });
  }

  // ---- Ingest -------------------------------------------------------------------------------

  /** Starts a session for a chosen file: detect its settings. */
  openFile(file: File): void {
    this.reset();
    this.set({ phase: "opening", fileName: file.name, fileSize: file.size });
    this.profileWorker = this.makeProfileWorker();
    this.send({ type: "open", file });
  }

  /** Edits a setting the user changed on the confirmation panel. */
  editSettings(patch: Partial<FileSettings>): void {
    if (this.state.settings) this.set({ settings: { ...this.state.settings, ...patch } });
  }

  /** Loads the file with the confirmed settings, then profiles it. */
  confirmAndProfile(): void {
    const settings = this.state.settings;
    if (
      !settings ||
      isExcelSettings(settings) ||
      isParquetSettings(settings) ||
      isJsonSettings(settings)
    )
      return;
    this.pending.clear();
    this.base = [];
    this.edits = {};
    this.engine = {};
    this.set({
      phase: "loading",
      error: null,
      progress: null,
      profiles: [],
      busy: [],
      reviewError: null,
      datePatternChecks: {},
    });
    this.send({ type: "load", settings });
  }

  /** Loads the Parquet file that was opened, then profiles it. */
  confirmParquet(): void {
    if (!this.state.parquet) return;
    this.pending.clear();
    this.base = [];
    this.edits = {};
    this.engine = {};
    this.set({
      phase: "loading",
      error: null,
      progress: null,
      profiles: [],
      busy: [],
      reviewError: null,
      datePatternChecks: {},
    });
    this.send({ type: "loadParquet" });
  }

  /** Loads the JSON file that was opened, then profiles it. */
  confirmJson(): void {
    if (!this.state.json) return;
    this.pending.clear();
    this.base = [];
    this.edits = {};
    this.engine = {};
    this.set({
      phase: "loading",
      error: null,
      progress: null,
      profiles: [],
      busy: [],
      reviewError: null,
      datePatternChecks: {},
    });
    this.send({ type: "loadJson" });
  }

  /** Asks for the hints of a sheet (rows to skip, width, formats) while the load dialog is open. */
  inspectSheet(sheet: string): void {
    if (this.state.workbook?.hints[sheet]) return;
    this.send({ type: "inspectSheet", sheet });
  }

  /** Loads the sheet the user confirmed in the load dialog, then profiles it. */
  confirmWorkbook(choice: WorkbookChoice): void {
    const workbook = this.state.workbook;
    if (!workbook) return;
    this.pending.clear();
    this.base = [];
    this.edits = {};
    this.engine = {};
    this.set({
      phase: "loading",
      error: null,
      progress: null,
      profiles: [],
      busy: [],
      reviewError: null,
      datePatternChecks: {},
    });
    this.send({ type: "loadSheet", ...choice, date1904: workbook.info.date1904 });
  }

  cancel(): void {
    this.send({ type: "cancel" });
    this.generateWorker?.postMessage({ type: "cancel" } satisfies GenerateRequest);
  }

  /**
   * Loads a saved spec in place of a file (FR-004): a good one replaces whatever is open and goes to
   * Review; a bad one leaves the session as it was and lists its problems by column.
   */
  async loadSpecFile(file: File): Promise<void> {
    const result = await readSpecFile(file);
    if (!result.ok) {
      this.set({ specProblems: result.problems });
      return;
    }
    this.loadSpec(result.spec, false);
  }

  /** Takes a spec as the table to review: one the person loaded, or one built from a design. */
  loadSpec(spec: SpecFile, designed: boolean): void {
    this.reset();
    const profiles = profilesFromSpec(spec.columns);
    this.base = profiles;
    this.set({
      phase: "profiled",
      specOnly: true,
      designed,
      specProblems: null,
      fileName: spec.source.file_name,
      settings: settingsFromSource(spec.source),
      columnNames: spec.columns.map((c) => c.name),
      rowCount: spec.n_rows,
      threshold: spec.categorical_threshold ?? initialSession.threshold,
      seedText: String(spec.seed),
      keepOriginalName: spec.keep_original_name ?? false,
      rules: spec.rules ? [...spec.rules] : [],
      profiles,
    });
    this.onSpecLoaded(
      profiles.map((p) => ({ name: p.name, type: p.type })),
      designed,
    );
  }

  private makeProfileWorker(): Worker {
    const worker = new Worker(new URL("../workers/profile.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent<ProfileResponse>) => this.onProfileMessage(e.data);
    worker.onerror = () =>
      this.set({ phase: "error", error: "The profiling worker stopped unexpectedly." });
    return worker;
  }

  private send(message: ProfileRequest): void {
    this.profileWorker?.postMessage(message);
  }

  private onProfileMessage(msg: ProfileResponse): void {
    switch (msg.type) {
      case "settingsDetected":
        this.set({
          phase: "opened",
          settings: msg.settings,
          confidence: msg.confidence,
          columnNames: msg.columnNames,
          fileName: msg.fileName,
          fileSize: msg.fileSize,
        });
        break;
      case "workbookInfo":
        this.set({
          phase: "workbook",
          workbook: { info: msg.info, hints: {} },
          fileName: msg.fileName,
          fileSize: msg.fileSize,
        });
        break;
      case "parquetInfo":
        this.set({
          phase: "parquet",
          parquet: msg.info,
          fileName: msg.fileName,
          fileSize: msg.fileSize,
          columnNames: msg.info.columns.map((c) => c.name),
        });
        break;
      case "jsonInfo":
        this.set({
          phase: "json",
          json: msg.info,
          fileName: msg.fileName,
          fileSize: msg.fileSize,
          columnNames: msg.info.keys.map((k) => k.name),
        });
        break;
      case "sheetHints":
        if (this.state.workbook)
          this.set({
            workbook: {
              ...this.state.workbook,
              hints: { ...this.state.workbook.hints, [msg.sheet]: msg.hints },
            },
          });
        break;
      case "loaded":
        this.set({
          phase: "profiling",
          rowCount: msg.rowCount,
          columnNames: msg.columnNames,
          settings: msg.settings,
          progress: null,
        });
        this.send({ type: "profile", threshold: this.state.threshold, overrides: this.engine });
        break;
      case "progress":
        this.set({ progress: { job: msg.job, done: msg.done, total: msg.total } });
        break;
      case "columnProfile":
        if (this.state.phase === "profiled")
          this.replaceBase(msg.profile); // one column profiled again
        else this.pending.set(msg.profile.name, msg.profile);
        break;
      case "profiled": {
        this.base = this.state.columnNames
          .map((n) => this.pending.get(n))
          .filter((p): p is ColumnProfile => p !== undefined);
        this.set({
          phase: "profiled",
          profiles: applyAllEdits(this.base, this.edits),
          progress: null,
          busy: [],
        });
        this.onProfiled(this.base.map((p) => ({ name: p.name, type: p.type })));
        break;
      }
      case "error":
        // Before the review exists a problem blocks everything; after it, the screen stays usable.
        if (this.state.phase === "profiled" || this.base.length > 0)
          this.set({ reviewError: msg.error.message, busy: [], progress: null, phase: "profiled" });
        else this.set({ phase: "error", error: msg.error.message, progress: null });
        break;
      case "datePatternResult": {
        const check = this.state.datePatternChecks[msg.column];
        if (check)
          this.set({
            datePatternChecks: {
              ...this.state.datePatternChecks,
              [msg.column]: { ...check, parsed: msg.parsed, total: msg.total },
            },
          });
        break;
      }
    }
  }

  // ---- Review: change a column --------------------------------------------------------------

  private replaceBase(profile: ColumnProfile): void {
    this.base = this.base.map((p) => (p.name === profile.name ? profile : p));
    this.set({
      profiles: applyAllEdits(this.base, this.edits),
      busy: this.state.busy.filter((n) => n !== profile.name),
      reviewError: null,
    });
  }

  private needSourceFile(): void {
    this.set({
      reviewError: this.state.designed
        ? "This table was designed in this app, so there is no file to read. Change this setting in Design."
        : "This table was loaded from a saved spec, so there is no file to read. Open the original file to change this setting.",
    });
  }

  /** A change that needs no data: applied at once, and kept across any later re-profile. */
  editColumn(name: string, patch: LocalEdits): void {
    this.edits = { ...this.edits, [name]: { ...this.edits[name], ...patch } };
    this.set({ profiles: applyAllEdits(this.base, this.edits) });
  }

  /** A change the worker must apply by profiling the column again. A key set to undefined is removed. */
  overrideColumn(name: string, patch: Partial<ColumnOverrides>): void {
    if (this.state.specOnly) return this.needSourceFile();
    const next: ColumnOverrides = { ...this.engine[name], ...patch };
    for (const key of Object.keys(patch) as (keyof ColumnOverrides)[])
      if (patch[key] === undefined) delete next[key];
    this.engine = { ...this.engine, [name]: next };
    this.set({ busy: [...new Set([...this.state.busy, name])], reviewError: null });
    this.send({ type: "reprofile", column: name, overrides: next });
  }

  /** Changes the distinct-value limit for categorical columns and profiles every column again. */
  setThreshold(threshold: number): void {
    if (this.state.specOnly) return this.needSourceFile();
    if (!Number.isInteger(threshold) || threshold < 2 || threshold > 2000) return;
    this.pending.clear();
    this.set({ threshold, phase: "profiling", progress: null, reviewError: null });
    this.send({ type: "profile", threshold, overrides: this.engine });
  }

  /** Asks the worker how many values a typed date pattern parses (FR-005a). */
  checkDatePattern(name: string, pattern: string): void {
    if (this.state.specOnly) return this.needSourceFile();
    this.set({
      datePatternChecks: {
        ...this.state.datePatternChecks,
        [name]: { pattern, parsed: null, total: null },
      },
    });
    this.send({ type: "datePattern", column: name, pattern });
  }

  // ---- Samples ------------------------------------------------------------------------------

  /** Asks the generating worker for a few invented values to show on a card. */
  requestSamples(name: string, description: SampleDescription): void {
    if (!this.sampleWorker) {
      const worker = new Worker(new URL("../workers/generate.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (e: MessageEvent<GenerateResponse>) => {
        const msg = e.data;
        if (msg.type !== "samples") return;
        const column = this.sampleRequests.get(msg.id);
        this.sampleRequests.delete(msg.id);
        if (column === undefined || this.sampleLatest.get(column) !== msg.id) return; // an older request
        this.set({ samples: { ...this.state.samples, [column]: msg.values } });
      };
      this.sampleWorker = worker;
    }
    const id = ++this.sampleSeq;
    this.sampleRequests.set(id, name);
    this.sampleLatest.set(name, id);
    this.sampleWorker.postMessage({
      type: "sample",
      id,
      description,
      count: 5,
      seed: parseSeed(this.state.seedText) ?? 42,
    } satisfies GenerateRequest);
  }

  // ---- Generate -----------------------------------------------------------------------------

  setSeedText(seedText: string): void {
    this.set({ seedText });
  }

  setKeepOriginalName(keepOriginalName: boolean): void {
    this.set({ keepOriginalName });
  }

  /** The spec for the current profiles and settings. */
  buildSpec(): SpecFile | null {
    const { settings, profiles } = this.state;
    if (!settings || profiles.length === 0) return null;
    return buildSpec({
      fileName: this.state.fileName,
      settings,
      rowCount: this.state.rowCount,
      seed: parseSeed(this.state.seedText) ?? 42,
      keepOriginalName: this.state.keepOriginalName,
      threshold: this.state.threshold,
      profiles,
      rules: this.state.rules,
    });
  }

  /** Adds a rule between two columns; a rule that would not be valid is not added, and the reason is returned. */
  addRule(rule: RuleSpec): string | null {
    const spec = this.buildSpecWith([...this.state.rules, rule]);
    if (!spec) return "There is no table to add a rule to.";
    const checked = validateSpec(JSON.parse(JSON.stringify(spec)));
    if (!checked.ok)
      return (
        checked.problems.find((p) => p.path.startsWith("rules"))?.message ??
        "This rule does not fit the table."
      );
    this.set({ rules: [...this.state.rules, rule] });
    return null;
  }

  removeRule(index: number): void {
    this.set({ rules: this.state.rules.filter((_, i) => i !== index) });
  }

  private buildSpecWith(rules: RuleSpec[]): SpecFile | null {
    const { settings, profiles } = this.state;
    if (!settings || profiles.length === 0) return null;
    return buildSpec({
      fileName: this.state.fileName,
      settings,
      rowCount: this.state.rowCount,
      seed: parseSeed(this.state.seedText) ?? 42,
      keepOriginalName: this.state.keepOriginalName,
      threshold: this.state.threshold,
      profiles,
      rules,
    });
  }

  generate(): void {
    const seed = parseSeed(this.state.seedText);
    if (seed === null) {
      this.setGen({
        ...emptyGen,
        status: "error",
        error: "Enter a whole number from 0 to 4,294,967,295 as the seed.",
      });
      return;
    }
    const spec = this.buildSpec();
    if (!spec) return;

    this.generateWorker?.terminate();
    this.parts = [];
    this.setGen({ ...emptyGen, status: "running" });

    const worker = new Worker(new URL("../workers/generate.worker.ts", import.meta.url), {
      type: "module",
    });
    this.generateWorker = worker;
    worker.onmessage = (e: MessageEvent<GenerateResponse>) => this.onGenerateMessage(e.data);
    worker.onerror = () =>
      this.setGen({ status: "error", error: "The generating worker stopped unexpectedly." });
    worker.postMessage({ type: "generate", spec, seed, chunkRows: 5000 } satisfies GenerateRequest);
  }

  private onGenerateMessage(msg: GenerateResponse): void {
    switch (msg.type) {
      case "preview":
        this.setGen({ header: msg.header, preview: msg.rows });
        break;
      case "chunk":
        this.parts.push(new Uint8Array(msg.bytes));
        break;
      case "progress":
        this.setGen({ progress: { job: "generate", done: msg.rowsDone, total: msg.rowsTotal } });
        break;
      case "checks":
        this.setGen({ checks: msg.checks });
        break;
      case "done":
        this.setGen({
          status: "done",
          totalBytes: msg.totalBytes,
          replaced: msg.replaced,
          codec: msg.codec,
        });
        break;
      case "error":
        this.parts = [];
        this.setGen({
          status: msg.error.code === "cancelled" ? "cancelled" : "error",
          error: msg.error.message,
        });
        break;
    }
  }

  // ---- Export -------------------------------------------------------------------------------

  /** The fake CSV as a Blob, or null before a run has finished. */
  fakeBlob(): Blob | null {
    const settings = this.state.settings;
    const type =
      settings && isExcelSettings(settings)
        ? XLSX_MIME
        : settings && isParquetSettings(settings)
          ? PARQUET_MIME
          : settings && isJsonSettings(settings)
            ? settings.layout.form === "lines"
              ? NDJSON_MIME
              : JSON_MIME
            : "text/csv";
    return this.state.gen.status === "done" ? new Blob(this.parts as BlobPart[], { type }) : null;
  }

  fakeFileName(): string {
    return exportName(this.state.fileName, this.state.keepOriginalName);
  }

  specBlob(): Blob | null {
    const spec = this.buildSpec();
    return spec ? specBlobOf(spec) : null;
  }

  /** Keeps the labels of a codebook beside the columns they belong to (Review shows them; the README lists them). */
  applyCodebook(labels: Record<string, Record<string, string>>): void {
    for (const [name, values] of Object.entries(labels))
      this.editColumn(name, { valueLabels: values });
  }

  /** The README that goes with the fake file, as a Markdown Blob, or null before a spec can be built. */
  readmeBlob(): Blob | null {
    const spec = this.buildSpec();
    if (!spec) return null;
    const text = agentReadme(spec, {
      fakeFileName: this.fakeFileName(),
      specFileName: this.specFileName(),
      seed: parseSeed(this.state.seedText) ?? spec.seed,
      appVersion: APP_VERSION,
    });
    return new Blob([text], { type: "text/markdown" });
  }

  readmeFileName(): string {
    return readmeFileNameFor(this.fakeFileName());
  }

  specFileName(): string {
    return specFileNameFor(this.state.fileName);
  }

  // ---- Reset --------------------------------------------------------------------------------

  /** Drops everything, including the workers and the data they hold. */
  reset(): void {
    this.profileWorker?.terminate();
    this.generateWorker?.terminate();
    this.sampleWorker?.terminate();
    this.profileWorker = null;
    this.generateWorker = null;
    this.sampleWorker = null;
    this.sampleRequests.clear();
    this.sampleLatest.clear();
    this.parts = [];
    this.pending.clear();
    this.base = [];
    this.edits = {};
    this.engine = {};
    this.state = initialSession;
    this.listeners.forEach((l) => l(this.state));
  }
}
