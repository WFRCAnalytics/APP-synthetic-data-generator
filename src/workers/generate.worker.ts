/// <reference lib="webworker" />
// Generates the fake table from a spec alone: it never receives the real file, and it does not use
// DuckDB (constitution Principle II). The CSV is produced and encoded in chunks, so the whole file
// is never held here; the check table is measured while the rows are produced.

import { AppError, sanitizeError, toWireError } from "../lib/errors";
import { NET_CHANNEL } from "../lib/netChannel";
import { installNetPatch } from "./netpatch";
import { CheckAccumulator } from "../lib/generate/checks";
import { renderChunks } from "../lib/generate/render";
import { planTable, rowValues, type TablePlan } from "../lib/generate/table";
import { previewCells, writeWorkbook } from "../lib/generate/xlsx";
import type { SpecFile } from "../lib/spec/types";
import { sampleValues } from "../lib/textgen/sample";
import { validateSpec } from "../lib/spec/validate";
import type { GenerateRequest, GenerateResponse } from "./protocol";

installNetPatch(NET_CHANNEL, self.location.origin);

const PREVIEW_ROWS = 50;

const post = (message: GenerateResponse, transfer: Transferable[] = []) => self.postMessage(message, transfer);

let cancelled = false;

// Lets a queued "cancel" message run between chunks.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function generate(request: Extract<GenerateRequest, { type: "generate" }>): Promise<void> {
  cancelled = false;

  const validated = validateSpec(request.spec);
  if (!validated.ok) throw new AppError("spec_invalid");

  let plan;
  try {
    plan = planTable(validated.spec, request.seed);
  } catch {
    throw new AppError("generation_error"); // the message of the underlying error is not shown
  }
  if (validated.spec.source.format === "xlsx") return generateWorkbook(validated.spec, plan, request);

  // The preview is fake data, so showing it is safe.
  const rows: string[][] = [];
  for (let r = 0; r < Math.min(PREVIEW_ROWS, plan.nRows); r++) rows.push(rowValues(plan, r));
  post({ type: "preview", header: plan.header, rows });

  const checks = new CheckAccumulator(plan);
  let totalBytes = 0;
  let replaced = 0;

  for (const chunk of renderChunks(plan, request.chunkRows, (values) => checks.observeRow(values))) {
    totalBytes += chunk.bytes.length;
    replaced += chunk.replaced;
    post({ type: "chunk", bytes: chunk.bytes.buffer as ArrayBuffer }, [chunk.bytes.buffer]);
    post({ type: "progress", rowsDone: chunk.rowsDone, rowsTotal: plan.nRows });
    await tick();
    if (cancelled) throw new AppError("cancelled");
  }

  post({ type: "checks", checks: checks.finish() });
  post({ type: "done", totalBytes, replaced });
}

/** A spec for a sheet: the same table, written as a workbook streamed in chunks (specs/003). */
async function generateWorkbook(spec: SpecFile, plan: TablePlan, request: Extract<GenerateRequest, { type: "generate" }>): Promise<void> {
  const rows: string[][] = [];
  for (let r = 0; r < Math.min(PREVIEW_ROWS, plan.nRows); r++) rows.push(previewCells(rowValues(plan, r)));
  post({ type: "preview", header: plan.header, rows });

  const checks = new CheckAccumulator(plan);
  let totalBytes = 0;
  const run = writeWorkbook(
    spec,
    request.seed,
    request.chunkRows,
    (values) => checks.observeRow(values),
    async (rowsDone) => {
      post({ type: "progress", rowsDone, rowsTotal: plan.nRows });
      await tick(); // lets a queued "cancel" message run between chunks
      if (cancelled) throw new AppError("cancelled");
    },
  );
  for await (const chunk of run.chunks) {
    totalBytes += chunk.length;
    // A chunk from the compressor may be a view into a larger buffer; copy it so only its own bytes are sent.
    const own = chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength ? chunk : chunk.slice();
    post({ type: "chunk", bytes: own.buffer as ArrayBuffer }, [own.buffer]);
  }
  post({ type: "checks", checks: checks.finish() });
  post({ type: "done", totalBytes, replaced: 0 });
}

self.onmessage = async (event: MessageEvent<GenerateRequest>) => {
  const msg = event.data;
  if (msg.type === "cancel") {
    cancelled = true;
    return;
  }
  if (msg.type === "sample") {
    try {
      post({ type: "samples", id: msg.id, values: sampleValues(msg.description, msg.count, msg.seed) });
    } catch (err) {
      post({ type: "error", error: toWireError(sanitizeError(err)) });
    }
    return;
  }
  try {
    await generate(msg);
  } catch (err) {
    post({ type: "error", error: toWireError(sanitizeError(err)) });
  }
};
