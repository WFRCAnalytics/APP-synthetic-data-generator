// How values are laid out in a Parquet data page (specs/005 research R3): PLAIN encoding for each physical
// type, bit-packed booleans, big-endian two's complement decimals, and the RLE / bit-packed hybrid used for
// definition levels. Tested against the format specification's vectors and, end to end, by two readers.

import type { Physical } from "./types";

export type PlainValue = number | bigint | boolean | Uint8Array;

/**
 * The PLAIN encoding of the non-null values of a column chunk.
 * INT32 takes numbers (an unsigned 32-bit value above 2^31 is written as its bits), INT64 numbers or
 * bigints (an unsigned 64-bit value above 2^63 likewise), FLOAT and DOUBLE numbers, BOOLEAN booleans,
 * BYTE_ARRAY and FIXED_LEN_BYTE_ARRAY byte arrays.
 */
export function encodePlain(physical: Physical, values: readonly PlainValue[], typeLength?: number): Uint8Array {
  switch (physical) {
    case "INT32": {
      const out = new Uint8Array(values.length * 4);
      const view = new DataView(out.buffer);
      values.forEach((v, i) => view.setInt32(i * 4, Number(v) | 0, true));
      return out;
    }
    case "INT64": {
      const out = new Uint8Array(values.length * 8);
      const view = new DataView(out.buffer);
      values.forEach((v, i) => view.setBigInt64(i * 8, BigInt.asIntN(64, BigInt(v as number | bigint)), true));
      return out;
    }
    case "FLOAT": {
      const out = new Uint8Array(values.length * 4);
      const view = new DataView(out.buffer);
      values.forEach((v, i) => view.setFloat32(i * 4, Number(v), true));
      return out;
    }
    case "DOUBLE": {
      const out = new Uint8Array(values.length * 8);
      const view = new DataView(out.buffer);
      values.forEach((v, i) => view.setFloat64(i * 8, Number(v), true));
      return out;
    }
    case "BOOLEAN": {
      const out = new Uint8Array(Math.ceil(values.length / 8));
      values.forEach((v, i) => {
        if (v) out[i >> 3] |= 1 << (i & 7);
      });
      return out;
    }
    case "BYTE_ARRAY": {
      let size = 0;
      for (const v of values) size += 4 + (v as Uint8Array).length;
      const out = new Uint8Array(size);
      const view = new DataView(out.buffer);
      let at = 0;
      for (const v of values) {
        const bytes = v as Uint8Array;
        view.setUint32(at, bytes.length, true);
        out.set(bytes, at + 4);
        at += 4 + bytes.length;
      }
      return out;
    }
    case "FIXED_LEN_BYTE_ARRAY": {
      const length = typeLength ?? 0;
      const out = new Uint8Array(values.length * length);
      values.forEach((v, i) => {
        const bytes = v as Uint8Array;
        if (bytes.length !== length) throw new Error(`A fixed-length value must be ${length} bytes, not ${bytes.length}.`);
        out.set(bytes, i * length);
      });
      return out;
    }
  }
}

/** A decimal's unscaled integer as big-endian two's complement bytes of the given length. */
export function decimalBytesBE(value: bigint, length: number): Uint8Array {
  const bits = BigInt(length * 8);
  const limit = 2n ** (bits - 1n);
  if (value >= limit || value < -limit) throw new Error(`The decimal value does not fit in ${length} bytes.`);
  let v = BigInt.asUintN(length * 8, value);
  const out = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function varintBytes(value: number): number[] {
  const out: number[] = [];
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
}

/**
 * Definition levels (1 = value present, 0 = null) for an optional column, in the RLE / bit-packed hybrid
 * with a bit width of one, preceded by the four byte length that a version 1 data page puts in front of
 * them. All the same value is one RLE run; anything else is one bit-packed run, padded to groups of eight.
 */
export function encodeLevels(levels: ArrayLike<number | boolean>): Uint8Array {
  const n = levels.length;
  let body: number[] = [];
  if (n > 0) {
    const first = levels[0] ? 1 : 0;
    let constant = true;
    for (let i = 1; i < n; i++) {
      if ((levels[i] ? 1 : 0) !== first) {
        constant = false;
        break;
      }
    }
    if (constant) {
      body = [...varintBytes(n * 2), first];
    } else {
      const groups = Math.ceil(n / 8);
      body = varintBytes(groups * 2 + 1);
      const packed = new Uint8Array(groups);
      for (let i = 0; i < n; i++) if (levels[i]) packed[i >> 3] |= 1 << (i & 7);
      body.push(...packed);
    }
  }
  const out = new Uint8Array(4 + body.length);
  new DataView(out.buffer).setUint32(0, body.length, true);
  out.set(body, 4);
  return out;
}
