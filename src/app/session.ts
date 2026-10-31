// Coordinates the two workers and holds everything the screens show. Real data never passes
// through here: the profile worker posts summaries only, and the generated CSV arrives as bytes of
// fake data. Nothing is written to browser storage, so a reload clears it all (Principle I).

import type { CheckRow } from "../lib/generate/checks";
import type { ColumnProfile, FileSettings } from "../lib/profile/types";
import { buildSpec } from "../lib/spec/build";
import type { SpecFile } from "../lib/spec/types";
import type { GenerateRequest, GenerateResponse, ProfileJob, ProfileRequest, ProfileResponse } from "../workers/protocol";

export type Phase = "idle" | "opening" | "opened" | "loading" | "profiling" | "profiled" | "error";

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
}

export interface SessionState {
  phase: Phase;
  error: string | null;
  fileName: string;
  fileSize: number;
  settings: FileSettings | null;
  confidence: "high" | "medium" | "low";
  /** Names only, as detected or re-derived from the settings. */
  columnNames: string[];
  rowCount: number;
  progress: Progress | null;
  profiles: ColumnProfile[];
  threshold: number;
  seedText: string;
  keepOriginalName: boolean;
  gen: GenState;
}

const emptyGen: GenState = { status: "idle", progress: null, header: [], preview: [], checks: [], error: null, totalBytes: 0, replaced: 0 };

export const initialSession: SessionState = {
  phase: "idle",
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
  seedText: "42",
  keepOriginalName: false,
  gen: emptyGen,
};

export const MAX_SEED = 4294967295;

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
  onProfiled: (columns: { name: string; type: string }[]) => void = () => {};

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
    if (!this.state.settings) return;
    this.pending.clear();
    this.set({ phase: "loading", error: null, progress: null, profiles: [] });
    this.send({ type: "load", settings: this.state.settings });
  }

  cancel(): void {
    this.send({ type: "cancel" });
    this.generateWorker?.postMessage({ type: "cancel" } satisfies GenerateRequest);
  }

  private makeProfileWorker(): Worker {
    const worker = new Worker(new URL("../workers/profile.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<ProfileResponse>) => this.onProfileMessage(e.data);
    worker.onerror = () => this.set({ phase: "error", error: "The profiling worker stopped unexpectedly." });
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
      case "loaded":
        this.set({ phase: "profiling", rowCount: msg.rowCount, columnNames: msg.columnNames, settings: msg.settings, progress: null });
        this.send({ type: "profile", threshold: this.state.threshold });
        break;
      case "progress":
        this.set({ progress: { job: msg.job, done: msg.done, total: msg.total } });
        break;
      case "columnProfile":
        this.pending.set(msg.profile.name, msg.profile);
        break;
      case "profiled": {
        const profiles = this.state.columnNames.map((n) => this.pending.get(n)).filter((p): p is ColumnProfile => p !== undefined);
        this.set({ phase: "profiled", profiles, progress: null });
        this.onProfiled(profiles.map((p) => ({ name: p.name, type: p.type })));
        break;
      }
      case "error":
        this.set({ phase: "error", error: msg.error.message, progress: null });
        break;
      case "datePatternResult":
      case "net":
        break;
    }
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
    });
  }

  generate(): void {
    const seed = parseSeed(this.state.seedText);
    if (seed === null) {
      this.setGen({ ...emptyGen, status: "error", error: "Enter a whole number from 0 to 4,294,967,295 as the seed." });
      return;
    }
    const spec = this.buildSpec();
    if (!spec) return;

    this.generateWorker?.terminate();
    this.parts = [];
    this.setGen({ ...emptyGen, status: "running" });

    const worker = new Worker(new URL("../workers/generate.worker.ts", import.meta.url), { type: "module" });
    this.generateWorker = worker;
    worker.onmessage = (e: MessageEvent<GenerateResponse>) => this.onGenerateMessage(e.data);
    worker.onerror = () => this.setGen({ status: "error", error: "The generating worker stopped unexpectedly." });
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
        this.setGen({ status: "done", totalBytes: msg.totalBytes, replaced: msg.replaced });
        break;
      case "error":
        this.parts = [];
        this.setGen({ status: msg.error.code === "cancelled" ? "cancelled" : "error", error: msg.error.message });
        break;
      case "net":
        break;
    }
  }

  // ---- Export -------------------------------------------------------------------------------

  /** The fake CSV as a Blob, or null before a run has finished. */
  fakeBlob(): Blob | null {
    return this.state.gen.status === "done" ? new Blob(this.parts as BlobPart[], { type: "text/csv" }) : null;
  }

  fakeFileName(): string {
    return exportName(this.state.fileName, this.state.keepOriginalName);
  }

  specBlob(): Blob | null {
    const spec = this.buildSpec();
    return spec ? new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" }) : null;
  }

  specFileName(): string {
    const base = this.state.fileName.replace(/\.[^.]*$/, "") || "table";
    return `${base}_spec.json`;
  }

  // ---- Reset --------------------------------------------------------------------------------

  /** Drops everything, including the workers and the data they hold. */
  reset(): void {
    this.profileWorker?.terminate();
    this.generateWorker?.terminate();
    this.profileWorker = null;
    this.generateWorker = null;
    this.parts = [];
    this.pending.clear();
    this.state = initialSession;
    this.listeners.forEach((l) => l(this.state));
  }
}
