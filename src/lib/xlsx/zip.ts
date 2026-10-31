// The zip container of an .xlsx (specs/003 research R7, R11). Reading looks only at the central
// directory at the end of the file and at the entries asked for, so a workbook is never read whole;
// writing streams entries (each deflated by the browser's own CompressionStream) with data
// descriptors, so a 500 MB sheet never has to sit in memory. Zip64 (files over 4 GB) is refused.

export class ZipError extends Error {
  constructor(
    readonly code: "not_zip" | "damaged" | "unsupported" | "bad_name",
    message: string,
  ) {
    super(message);
    this.name = "ZipError";
  }
}

// ---- CRC-32 ------------------------------------------------------------------------------------

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** The CRC-32 of bytes; pass the previous result as `crc` to continue over another chunk. */
export function crc32(bytes: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

// ---- Reading -----------------------------------------------------------------------------------

export interface ZipEntry {
  name: string;
  method: number; // 0 stored, 8 deflated
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  /** Offset of the entry's local header. */
  offset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

async function bytesOf(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

/** Reads the central directory of a zip, from the end of the file. */
export async function readZipDirectory(blob: Blob): Promise<ZipEntry[]> {
  if (blob.size < 22) throw new ZipError("not_zip", "The file is too small to be a zip archive.");
  const tailStart = Math.max(0, blob.size - (65_535 + 22));
  const tail = await bytesOf(blob, tailStart, blob.size);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError(blob.size > 4 && (await bytesOf(blob, 0, 4))[0] === 0x50 ? "damaged" : "not_zip", "No zip directory was found.");

  const count = view.getUint16(eocd + 10, true);
  const dirSize = view.getUint32(eocd + 12, true);
  const dirOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) throw new ZipError("unsupported", "Zip64 archives are not supported.");
  if (dirOffset + dirSize > blob.size) throw new ZipError("damaged", "The zip directory points outside the file.");

  const dir = await bytesOf(blob, dirOffset, dirOffset + dirSize);
  const d = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > dir.length || d.getUint32(p, true) !== SIG_CENTRAL) throw new ZipError("damaged", "The zip directory is damaged.");
    const method = d.getUint16(p + 10, true);
    const crc = d.getUint32(p + 16, true);
    const compressedSize = d.getUint32(p + 20, true);
    const uncompressedSize = d.getUint32(p + 24, true);
    const nameLen = d.getUint16(p + 28, true);
    const extraLen = d.getUint16(p + 30, true);
    const commentLen = d.getUint16(p + 32, true);
    const offset = d.getUint32(p + 42, true);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || offset === 0xffffffff) throw new ZipError("unsupported", "Zip64 entries are not supported.");
    const utf8 = (d.getUint16(p + 8, true) & 0x800) !== 0;
    const name = new TextDecoder(utf8 ? "utf-8" : "latin1").decode(dir.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compressedSize, uncompressedSize, crc32: crc, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** A stream of an entry's uncompressed bytes. */
export async function openEntry(blob: Blob, entry: ZipEntry): Promise<ReadableStream<Uint8Array>> {
  const header = await bytesOf(blob, entry.offset, entry.offset + 30);
  const h = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (header.length < 30 || h.getUint32(0, true) !== SIG_LOCAL) throw new ZipError("damaged", "A zip entry header is damaged.");
  const start = entry.offset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  if (start + entry.compressedSize > blob.size) throw new ZipError("damaged", "A zip entry points outside the file.");
  const raw = blob.slice(start, start + entry.compressedSize).stream() as ReadableStream<Uint8Array>;
  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new ZipError("unsupported", `Compression method ${entry.method} is not supported.`);
  return raw.pipeThrough(new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
}

/** At least `limit` bytes from the start of an entry (fewer when it is shorter); reading stops early. */
export async function readEntryHead(blob: Blob, entry: ZipEntry, limit: number): Promise<Uint8Array> {
  const reader = (await openEntry(blob, entry)).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The whole text of an entry (use only for the small parts of a package). */
export async function readEntryText(blob: Blob, entry: ZipEntry, maxBytes = 64 * 1024 * 1024): Promise<string> {
  if (entry.uncompressedSize > maxBytes) throw new ZipError("unsupported", "The entry is too large to read as text.");
  const reader = (await openEntry(blob, entry)).getReader();
  const decoder = new TextDecoder("utf-8");
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

// ---- Writing -----------------------------------------------------------------------------------

export interface ZipWriter {
  addEntry(name: string, chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, options?: { store?: boolean }): Promise<void>;
  finish(): Promise<void>;
}

interface Written {
  name: Uint8Array;
  method: number;
  crc: number;
  compressed: number;
  uncompressed: number;
  offset: number;
}

const FLAG_DESCRIPTOR = 0x08;
const FLAG_UTF8 = 0x800;
// 2020-01-01 00:00:00 in DOS time and date: a fixed stamp keeps the output the same every run.
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

const u16 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
const u32 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
function join(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Writes a zip to `emit`, one chunk at a time. */
export function createZipWriter(emit: (chunk: Uint8Array) => void | Promise<void>): ZipWriter {
  const written: Written[] = [];
  let position = 0;
  const out = async (bytes: Uint8Array) => {
    if (bytes.length === 0) return;
    await emit(bytes);
    position += bytes.length;
  };

  return {
    async addEntry(name, chunks, options = {}) {
      if (name === "" || name.startsWith("/") || name.split("/").includes("..")) throw new ZipError("bad_name", "That entry name is not allowed.");
      const nameBytes = new TextEncoder().encode(name);
      const method = options.store ? 0 : 8;
      const offset = position;
      // Local header: sizes and CRC are zero, the real ones follow the data in a descriptor.
      await out(join(u32(SIG_LOCAL), u16(20), u16(FLAG_DESCRIPTOR | FLAG_UTF8), u16(method), u16(DOS_TIME), u16(DOS_DATE), u32(0), u32(0), u32(0), u16(nameBytes.length), u16(0), nameBytes));

      let crc = 0;
      let uncompressed = 0;
      let compressed = 0;
      const writeData = async (bytes: Uint8Array) => {
        compressed += bytes.length;
        await out(bytes);
      };

      if (method === 0) {
        for await (const chunk of chunks as AsyncIterable<Uint8Array>) {
          crc = crc32(chunk, crc);
          uncompressed += chunk.length;
          await writeData(chunk);
        }
      } else {
        const stream = new CompressionStream("deflate-raw");
        const writer = stream.writable.getWriter();
        const reader = stream.readable.getReader();
        // Read the compressed side while the input is written, so neither side waits on the other.
        const drain = (async () => {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            await writeData(value);
          }
        })();
        for await (const chunk of chunks as AsyncIterable<Uint8Array>) {
          crc = crc32(chunk, crc);
          uncompressed += chunk.length;
          await writer.write(chunk as Uint8Array<ArrayBuffer>);
        }
        await writer.close();
        await drain;
      }

      if (uncompressed >= 0xffffffff || compressed >= 0xffffffff || position >= 0xffffffff) throw new ZipError("unsupported", "The file is too large for a zip archive without Zip64.");
      await out(join(u32(0x08074b50), u32(crc), u32(compressed), u32(uncompressed)));
      written.push({ name: nameBytes, method, crc, compressed, uncompressed, offset });
    },

    async finish() {
      const dirStart = position;
      for (const e of written) {
        await out(join(u32(SIG_CENTRAL), u16(20), u16(20), u16(FLAG_DESCRIPTOR | FLAG_UTF8), u16(e.method), u16(DOS_TIME), u16(DOS_DATE), u32(e.crc), u32(e.compressed), u32(e.uncompressed), u16(e.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(e.offset), e.name));
      }
      const dirSize = position - dirStart;
      await out(join(u32(SIG_EOCD), u16(0), u16(0), u16(written.length), u16(written.length), u32(dirSize), u32(dirStart), u16(0)));
    },
  };
}
