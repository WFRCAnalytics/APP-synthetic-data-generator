// Making several tables from their saved specs in one go (specs/028). A spec holds everything a table needs, so each table runs in the
// generating worker on its own (the worker never sees real data), and the files come out together in one zip. Nothing is read from
// any real file, and nothing leaves the device.

import { agentReadme, readmeFileNameFor } from "../lib/readme/agentReadme";
import type { CheckRow } from "../lib/generate/checks";
import type { SpecFile, SurveyIdColumn } from "../lib/spec/types";
import { specBlobOf, specFileNameFor } from "../features/spec/saveSpec";
import { parseSpecText } from "../features/spec/loadSpec";
import type { GenerateRequest, GenerateResponse } from "../workers/protocol";
import { retarget, type OutputKind } from "../lib/spec/retarget";
import { statFileFromCsv } from "../lib/stat/convert";
import { isConvertKind, type ConvertKind } from "../lib/stat/detect";
import { APP_VERSION } from "./version";
import { exportName } from "./session";
import type { NamedBlob } from "./saveAll";

export interface BatchTable {
  id: number;
  /** The name of the spec file it came from. */
  specName: string;
  spec: SpecFile;
}

export interface BatchRejected {
  specName: string;
  reason: string;
}

/** The file type every table of a set is written as; "same" keeps what each spec says. */
export type BatchOutput = "same" | OutputKind | ConvertKind;

export interface BatchResult {
  parts: Uint8Array[];
  /** With an SPSS, Stata or SAS transport output: the finished file (the run itself is a CSV). */
  converted?: Uint8Array;
  /** Text values cut to fit that file type. */
  truncated?: number;
  totalBytes: number;
  checks: CheckRow[];
  passed: number;
  failed: number;
}

export const MAX_BATCH_TABLES = 24;

/** Reads the specs the person chose; a file that is not a valid spec is set aside with a plain reason. */
export async function loadBatch(files: readonly File[], firstId = 1): Promise<{ tables: BatchTable[]; rejected: BatchRejected[] }> {
  const tables: BatchTable[] = [];
  const rejected: BatchRejected[] = [];
  for (const file of files) {
    if (file.size > 5 * 1024 * 1024) {
      rejected.push({ specName: file.name, reason: "This file is too large to be a spec." });
      continue;
    }
    const result = parseSpecText(await file.text());
    if (!result.ok) rejected.push({ specName: file.name, reason: "This is not a valid spec." });
    else tables.push({ id: firstId + tables.length, specName: file.name, spec: result.spec });
  }
  return { tables, rejected };
}

const groupsOf = (c: SurveyIdColumn): number => Object.values(c.repeat_structure).reduce((a, b) => a + b, 0);

/** What does not fit between the tables of a set: an ID column that uses IDs no table of the set makes, and counts of tables that are missing. */
export function batchWarnings(tables: readonly BatchTable[]): string[] {
  const out: string[] = [];
  for (const t of tables) {
    for (const c of t.spec.columns) {
      if (c.type === "survey_id" && c.link) {
        const link = c.link;
        const found = tables.some(
          (o) => o !== t && o.spec.seed === link.seed && o.spec.columns.some((x) => x.type === "survey_id" && !x.link && x.name === link.column && groupsOf(x) === link.groups),
        );
        if (!found) out.push(`${t.specName}: "${c.name}" uses the IDs of "${link.column}"${link.table ? ` in ${link.table}` : ""} (seed ${link.seed}), which no table in this set makes, so a join will not match.`);
      }
      if (c.type === "integer" && c.child_count) {
        const cc = c.child_count;
        const found = tables.some(
          (o) => o !== t && o.spec.seed === cc.child.seed && o.spec.columns.some((x) => x.type === "survey_id" && x.name === cc.child.column && x.link?.column === cc.column && x.link.seed === t.spec.seed),
        );
        if (!found) out.push(`${t.specName}: "${c.name}" counts the rows of ${cc.child.table ?? "another table"}, which is not in this set, so its counts will not match.`);
      }
    }
  }
  return out;
}

/** The spec a table is run and saved with for this output; the statistical file types are written from a CSV run. */
export const specForOutput = (spec: SpecFile, output: BatchOutput): SpecFile =>
  output === "same" ? spec : retarget(spec, isConvertKind(output) ? "csv" : output);

/** The name the fake file of a table is written under. */
export function batchFileName(spec: SpecFile, output: BatchOutput = "same"): string {
  const keep = spec.keep_original_name ?? false;
  if (isConvertKind(output)) return exportName(`${spec.source.file_name.replace(/\.[^.]*$/, "")}.${output}`, keep);
  return exportName(specForOutput(spec, output).source.file_name, keep);
}

/** Makes one table in the generating worker. `onProgress` gets the share done, 0 to 1. */
export async function runTable(spec: SpecFile, onProgress: (share: number) => void, register: (cancel: () => void) => void, output: BatchOutput = "same"): Promise<BatchResult> {
  const run = specForOutput(spec, output);
  const result = await runSpec(run, onProgress, register);
  if (!isConvertKind(output)) return result;
  const { bytes, truncated } = statFileFromCsv(await new Blob(result.parts as BlobPart[]).text(), run, output);
  return { ...result, converted: bytes, truncated };
}

function runSpec(spec: SpecFile, onProgress: (share: number) => void, register: (cancel: () => void) => void): Promise<BatchResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/generate.worker.ts", import.meta.url), { type: "module" });
    const parts: Uint8Array[] = [];
    let checks: CheckRow[] = [];
    register(() => {
      worker.terminate();
      reject(new Error("cancelled"));
    });
    worker.onmessage = (e: MessageEvent<GenerateResponse>) => {
      const msg = e.data;
      if (msg.type === "chunk") parts.push(new Uint8Array(msg.bytes));
      else if (msg.type === "progress") onProgress(msg.rowsTotal > 0 ? msg.rowsDone / msg.rowsTotal : 1);
      else if (msg.type === "checks") checks = msg.checks;
      else if (msg.type === "done") {
        worker.terminate();
        const failed = checks.filter((c) => !c.pass).length;
        resolve({ parts, totalBytes: msg.totalBytes, checks, passed: checks.length - failed, failed });
      } else if (msg.type === "error") {
        worker.terminate();
        reject(new Error(msg.error.message));
      }
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("The generating worker stopped unexpectedly."));
    };
    worker.postMessage({ type: "generate", spec, seed: spec.seed, chunkRows: 5000 } satisfies GenerateRequest);
  });
}

/** Every table's fake file, spec and README, each table in a folder of its own (two tables may have the same file name). */
export function batchFiles(tables: readonly BatchTable[], results: ReadonlyMap<number, BatchResult>, output: BatchOutput = "same"): NamedBlob[] {
  const files: NamedBlob[] = [];
  const used = new Set<string>();
  for (const t of tables) {
    const r = results.get(t.id);
    if (!r) continue;
    const fake = batchFileName(t.spec, output);
    const saved = specForOutput(t.spec, output);
    const base = fake.replace(/\.[^.]*$/, "");
    let folder = base;
    for (let n = 2; used.has(folder); n++) folder = `${base}_${n}`;
    used.add(folder);
    const specName = specFileNameFor(t.spec.source.file_name);
    files.push({ name: `${folder}/${fake}`, blob: r.converted ? new Blob([r.converted as BlobPart], { type: "application/octet-stream" }) : new Blob(r.parts as BlobPart[]) });
    files.push({ name: `${folder}/${specName}`, blob: specBlobOf(saved) });
    files.push({ name: `${folder}/${readmeFileNameFor(fake)}`, blob: new Blob([agentReadme(saved, { fakeFileName: fake, specFileName: specName, seed: t.spec.seed, appVersion: APP_VERSION, statFormat: isConvertKind(output) ? output : undefined })], { type: "text/markdown" }) });
  }
  return files;
}
