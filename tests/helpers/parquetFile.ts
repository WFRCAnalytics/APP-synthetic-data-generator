// Builds the bytes of a fake Parquet file from cell texts, the way generation does (convert, then write), for
// tests that open the result with other readers.

import { createConverter, type Converter } from "../../src/lib/parquet/convert";
import { CREATED_BY_PREFIX, parquetChunks, type Codec, type ParquetColumn } from "../../src/lib/parquet/writer";

export interface BuiltParquet {
  bytes: Uint8Array;
  converters: Converter[];
}

export async function buildParquet(columns: ParquetColumn[], rows: (string | null)[][], options: { codec?: Codec; rowGroupRows?: number; createdBy?: string } = {}): Promise<BuiltParquet> {
  const converters = columns.map((c) => createConverter(c.type));
  async function* typed() {
    for (const row of rows) yield row.map((text, i) => (text === null ? null : converters[i].convert(text)));
  }
  const parts: Uint8Array[] = [];
  for await (const chunk of parquetChunks(columns, typed(), { createdBy: options.createdBy ?? `${CREATED_BY_PREFIX} 0.0.0-test`, codec: options.codec ?? "gzip", rowGroupRows: options.rowGroupRows })) parts.push(chunk);
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return { bytes, converters };
}
