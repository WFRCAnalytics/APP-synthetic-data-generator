// A streaming Parquet file writer (specs/005 research R3, R10, contracts/parquet-output.md). It takes typed
// rows and produces the file as it goes, one row group at a time, so memory stays bounded. Each row group
// holds one version 1 data page per column: definition levels (for optional columns) and PLAIN values,
// compressed together with gzip or left as they are. The footer names this app as the creator and carries no
// key-value metadata and no statistics, and nothing from the data is written anywhere except in its page.

import type { TypedValue } from "./convert";
import { decimalBytes, physicalOf, type ParquetType, type Physical } from "./types";
import { encodeLevels, encodePlain, type PlainValue } from "./encode";
import { ThriftWriter, TType } from "./thrift";

export const CREATED_BY_PREFIX = "synthetic-data-generator";
export const DEFAULT_ROW_GROUP_ROWS = 65_536;

export interface ParquetColumn {
  name: string;
  type: ParquetType;
}

export type Codec = "gzip" | "none";

export interface ParquetWriteOptions {
  /** The footer's creator text: this app and its version. */
  createdBy: string;
  codec: Codec;
  /** Rows per row group. */
  rowGroupRows?: number;
}

const MAGIC = new Uint8Array([0x50, 0x41, 0x52, 0x31]); // "PAR1"

const PHYSICAL_ID: Record<Physical, number> = { BOOLEAN: 0, INT32: 1, INT64: 2, FLOAT: 4, DOUBLE: 5, BYTE_ARRAY: 6, FIXED_LEN_BYTE_ARRAY: 7 };
const CODEC_ID: Record<Codec, number> = { none: 0, gzip: 2 };
const ENC_PLAIN = 0;
const ENC_RLE = 3;

/** The codec this browser can write: gzip through the platform's stream, else nothing. */
export function chooseCodec(): Codec {
  return typeof CompressionStream === "function" ? "gzip" : "none";
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  // The header's time is zero already; the system byte differs by platform in some zlib builds, so fix it.
  if (out.length > 10) out[9] = 0xff;
  return out;
}

// ---- schema ---------------------------------------------------------------------------------------------

/** ConvertedType ids, for readers that predate logical types. */
function convertedTypeOf(t: ParquetType): number | null {
  switch (t.kind) {
    case "int": {
      const base = t.signed ? 15 : 11; // INT_8 = 15, UINT_8 = 11
      return base + [8, 16, 32, 64].indexOf(t.bits as number);
    }
    case "decimal":
      return 5;
    case "string":
      return 0;
    case "date":
      return 6;
    case "time":
      return t.unit === "ms" ? 7 : t.unit === "us" ? 8 : null;
    case "timestamp":
      return t.unit === "ms" ? 9 : t.unit === "us" ? 10 : null;
    default:
      return null;
  }
}

function writeTimeUnit(w: ThriftWriter, id: number, unit: string): void {
  w.fieldStructBegin(id);
  w.fieldStructBegin(unit === "ms" ? 1 : unit === "us" ? 2 : 3);
  w.structEnd();
  w.structEnd();
}

function writeLogicalType(w: ThriftWriter, t: ParquetType): boolean {
  if (!["int", "decimal", "string", "date", "time", "timestamp"].includes(t.kind)) return false;
  w.fieldStructBegin(10);
  switch (t.kind) {
    case "string":
      w.fieldStructBegin(1);
      w.structEnd();
      break;
    case "decimal":
      w.fieldStructBegin(5);
      w.fieldI32(1, t.scale as number);
      w.fieldI32(2, t.precision as number);
      w.structEnd();
      break;
    case "date":
      w.fieldStructBegin(6);
      w.structEnd();
      break;
    case "time":
      w.fieldStructBegin(7);
      w.fieldBool(1, false);
      writeTimeUnit(w, 2, t.unit as string);
      w.structEnd();
      break;
    case "timestamp":
      w.fieldStructBegin(8);
      w.fieldBool(1, t.utc as boolean);
      writeTimeUnit(w, 2, t.unit as string);
      w.structEnd();
      break;
    case "int":
      w.fieldStructBegin(10);
      w.fieldByte(1, t.bits as number);
      w.fieldBool(2, t.signed as boolean);
      w.structEnd();
      break;
  }
  w.structEnd();
  return true;
}

function writeSchemaElement(w: ThriftWriter, col: ParquetColumn): void {
  const { physical, typeLength } = physicalOf(col.type);
  w.structBegin();
  w.fieldI32(1, PHYSICAL_ID[physical]);
  if (typeLength !== undefined) w.fieldI32(2, typeLength);
  w.fieldI32(3, col.type.nullable ? 1 : 0);
  w.fieldString(4, col.name);
  const converted = convertedTypeOf(col.type);
  if (converted !== null) w.fieldI32(6, converted);
  if (col.type.kind === "decimal") {
    w.fieldI32(7, col.type.scale as number);
    w.fieldI32(8, col.type.precision as number);
  }
  writeLogicalType(w, col.type);
  w.structEnd();
}

// ---- row groups -------------------------------------------------------------------------------------------

interface ChunkMeta {
  physical: Physical;
  type: ParquetType;
  name: string;
  offset: number;
  numValues: number;
  uncompressed: number;
  compressed: number;
}

interface ColumnBuffer {
  values: PlainValue[];
  defined: Uint8Array;
}

function writePageHeader(uncompressedSize: number, compressedSize: number, numValues: number): Uint8Array {
  const w = new ThriftWriter();
  w.structBegin();
  w.fieldI32(1, 0); // DATA_PAGE
  w.fieldI32(2, uncompressedSize);
  w.fieldI32(3, compressedSize);
  w.fieldStructBegin(5);
  w.fieldI32(1, numValues);
  w.fieldI32(2, ENC_PLAIN);
  w.fieldI32(3, ENC_RLE);
  w.fieldI32(4, ENC_RLE);
  w.structEnd();
  w.structEnd();
  return w.finish();
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function writeFooter(columns: readonly ParquetColumn[], groups: readonly { rows: number; chunks: ChunkMeta[] }[], totalRows: number, createdBy: string, codec: Codec): Uint8Array {
  const w = new ThriftWriter();
  w.structBegin();
  w.fieldI32(1, 1); // version

  w.fieldListBegin(2, TType.STRUCT, columns.length + 1);
  w.structBegin(); // the root of the schema
  w.fieldI32(3, 0);
  w.fieldString(4, "schema");
  w.fieldI32(5, columns.length);
  w.structEnd();
  for (const col of columns) writeSchemaElement(w, col);

  w.fieldI64(3, totalRows);

  w.fieldListBegin(4, TType.STRUCT, groups.length);
  for (const group of groups) {
    w.structBegin();
    w.fieldListBegin(1, TType.STRUCT, group.chunks.length);
    for (const chunk of group.chunks) {
      w.structBegin();
      w.fieldI64(2, chunk.offset);
      w.fieldStructBegin(3);
      w.fieldI32(1, PHYSICAL_ID[chunk.physical]);
      w.fieldListBegin(2, TType.I32, chunk.type.nullable ? 2 : 1);
      w.i32(ENC_PLAIN);
      if (chunk.type.nullable) w.i32(ENC_RLE);
      w.fieldListBegin(3, TType.BINARY, 1);
      w.string(chunk.name);
      w.fieldI32(4, CODEC_ID[codec]);
      w.fieldI64(5, chunk.numValues);
      w.fieldI64(6, chunk.uncompressed);
      w.fieldI64(7, chunk.compressed);
      w.fieldI64(9, chunk.offset);
      w.structEnd();
      w.structEnd();
    }
    w.fieldI64(2, group.chunks.reduce((n, c) => n + c.uncompressed, 0));
    w.fieldI64(3, group.rows);
    w.structEnd();
  }

  w.fieldString(6, createdBy);
  w.structEnd();
  return w.finish();
}

/**
 * Writes a Parquet file for typed rows (`null` is a null). The columns, their order and their types come
 * from the spec; a null in a column described as required is an error, because the file would be wrong.
 */
export async function* parquetChunks(columns: readonly ParquetColumn[], rows: AsyncIterable<readonly (TypedValue | null)[]> | Iterable<readonly (TypedValue | null)[]>, options: ParquetWriteOptions): AsyncGenerator<Uint8Array> {
  const rowGroupRows = Math.max(1, Math.floor(options.rowGroupRows ?? DEFAULT_ROW_GROUP_ROWS));
  const codec = options.codec === "gzip" && chooseCodec() === "gzip" ? "gzip" : "none";
  const physicals = columns.map((c) => physicalOf(c.type));

  let position = MAGIC.length;
  let totalRows = 0;
  const groups: { rows: number; chunks: ChunkMeta[] }[] = [];

  let count = 0;
  let buffers: ColumnBuffer[] = [];
  const reset = () => {
    count = 0;
    buffers = columns.map(() => ({ values: [], defined: new Uint8Array(rowGroupRows) }));
  };
  reset();

  async function flush(): Promise<Uint8Array[]> {
    if (count === 0) return [];
    const out: Uint8Array[] = [];
    const chunks: ChunkMeta[] = [];
    for (let c = 0; c < columns.length; c++) {
      const { type, name } = columns[c];
      const { physical, typeLength } = physicals[c];
      const values = encodePlain(physical, buffers[c].values, typeLength);
      const body = type.nullable ? concat([encodeLevels(buffers[c].defined.subarray(0, count)), values]) : values;
      const page = codec === "gzip" ? await gzip(body) : body;
      const header = writePageHeader(body.length, page.length, count);
      out.push(header, page);
      chunks.push({ physical, type, name, offset: position, numValues: count, uncompressed: header.length + body.length, compressed: header.length + page.length });
      position += header.length + page.length;
    }
    groups.push({ rows: count, chunks });
    totalRows += count;
    reset();
    return out;
  }

  yield MAGIC;
  for await (const row of rows) {
    for (let c = 0; c < columns.length; c++) {
      const value = row[c];
      if (value === null || value === undefined) {
        if (!columns[c].type.nullable) throw new Error(`A required column "${columns[c].name}" received a missing value.`);
      } else {
        buffers[c].defined[count] = 1;
        buffers[c].values.push(value);
      }
    }
    count++;
    if (count === rowGroupRows) for (const part of await flush()) yield part;
  }
  for (const part of await flush()) yield part;

  const footer = writeFooter(columns, groups, totalRows, options.createdBy, codec);
  yield footer;
  const tail = new Uint8Array(8);
  new DataView(tail.buffer).setUint32(0, footer.length, true);
  tail.set(MAGIC, 4);
  yield tail;
}

/** How many bytes a decimal of this precision takes when it is stored as fixed-length bytes (exposed for sizing). */
export const decimalStorageBytes = decimalBytes;
