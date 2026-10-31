/// <reference lib="webworker" />
// Generates the fake table from a spec alone: it never receives the real file, and it does not use
// DuckDB (constitution Principle II). The CSV is produced and encoded in chunks, so the whole file
// is never held here; the check table is measured while the rows are produced.

import { AppError, sanitizeError, toWireError } from "../lib/errors";
import { CheckAccumulator } from "../lib/generate/checks";
import { renderChunks } from "../lib/generate/render";
import { planTable, rowValues } from "../lib/generate/table";
import { validateSpec } from "../lib/spec/validate";
import type { GenerateRequest, GenerateResponse } from "./protocol";

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

self.onmessage = async (event: MessageEvent<GenerateRequest>) => {
  const msg = event.data;
  if (msg.type === "cancel") {
    cancelled = true;
    return;
  }
  try {
    await generate(msg);
  } catch (err) {
    post({ type: "error", error: toWireError(sanitizeError(err)) });
  }
};
