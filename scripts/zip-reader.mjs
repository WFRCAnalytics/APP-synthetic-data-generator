// Reads a zip held in memory (Node only, for the release checks). Handles stored and deflated entries,
// which is all the release zip contains. A damaged or unsupported zip throws.

import { inflateRawSync } from "node:zlib";

/**
 * @param {Uint8Array} bytes
 * @returns {{ name: string, data: Uint8Array, mode: number }[]}
 */
export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip file (no end-of-directory record)");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const out = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("damaged zip directory");
    const madeBy = view.getUint16(at + 4, true) >> 8;
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const external = view.getUint32(at + 38, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (view.getUint32(offset, true) !== 0x04034b50) throw new Error(`damaged zip entry header for ${name}`);
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const raw = bytes.subarray(start, start + compressed);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = new Uint8Array(inflateRawSync(raw));
    else throw new Error(`unsupported compression method ${method} for ${name}`);
    if (data.length !== size) throw new Error(`size mismatch for ${name}`);
    out.push({ name, data, mode: madeBy === 3 ? (external >>> 16) & 0o7777 : 0o644 });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}
