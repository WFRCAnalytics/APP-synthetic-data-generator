// Turns a table plan into the bytes of the output file, in chunks (FR-028, FR-035): BOM, header,
// rows, the original encoding, and no final line ending when the source had none. Chunking never
// changes the bytes, so the whole file can be streamed without holding it in memory.

import { bomFor, encodeText } from "../csv/encoders";
import { stripFinalEol } from "../csv/writer";
import { formatHeader, formatRows, type TablePlan } from "./table";

export interface RenderedChunk {
  bytes: Uint8Array;
  /** Data rows written so far, including this chunk. */
  rowsDone: number;
  /** Characters this chunk could not write in the file's encoding (written as "?"). */
  replaced: number;
}

export const DEFAULT_CHUNK_ROWS = 5000;

export function* renderChunks(
  plan: TablePlan,
  chunkRows: number = DEFAULT_CHUNK_ROWS,
  observe?: (values: string[]) => void,
): Generator<RenderedChunk> {
  const size = Math.max(1, Math.floor(chunkRows));
  const total = plan.nRows;
  let start = 0;
  let first = true;

  do {
    const end = Math.min(total, start + size);
    const last = end >= total;
    let text = (first ? formatHeader(plan) : "") + formatRows(plan, start, end, observe);
    if (last && !plan.dialect.trailingNewline) text = stripFinalEol(text, plan.dialect);

    const { bytes, replaced } = encodeText(text, plan.encoding);
    const bom = first && plan.bom ? bomFor(plan.encoding) : new Uint8Array(0);
    const out = new Uint8Array(bom.length + bytes.length);
    out.set(bom, 0);
    out.set(bytes, bom.length);

    yield { bytes: out, rowsDone: end, replaced };
    first = false;
    start = end;
  } while (start < total);
}

/** The whole file as one array. For tests and small tables only. */
export function renderAll(plan: TablePlan, chunkRows?: number): Uint8Array {
  const parts: Uint8Array[] = [];
  let length = 0;
  for (const chunk of renderChunks(plan, chunkRows)) {
    parts.push(chunk.bytes);
    length += chunk.bytes.length;
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
