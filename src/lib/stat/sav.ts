// An SPSS data file (.sav), uncompressed, little-endian, UTF-8 (specs/018). Written from typed columns; no value
// labels or other metadata. Long variable names go in the extension record that SPSS 12 and later read; dates are
// seconds since 1582-10-14, as SPSS keeps them.

import { cutToBytes, safeNames, type StatTable } from "./table";

/** The longest text one SPSS string variable holds without the very-long-string record. */
export const SAV_MAX_TEXT = 255;

const SYSMIS = (() => {
  const b = new DataView(new ArrayBuffer(8));
  b.setUint32(0, 0xffffffff, true);
  b.setUint32(4, 0xffefffff, true);
  return b.getFloat64(0, true);
})();
const HIGHEST = Number.MAX_VALUE;
const LOWEST = (() => {
  const b = new DataView(new ArrayBuffer(8));
  b.setUint32(0, 0xffffffff, true);
  b.setUint32(4, 0xffeeffff, true);
  return b.getFloat64(0, true);
})();

/** Seconds from 1582-10-14 (the SPSS zero) to 1970-01-01. */
const SPSS_EPOCH_SECONDS = 12_219_379_200;

const encoder = new TextEncoder();

const pad = (text: string, length: number): Uint8Array => {
  const out = new Uint8Array(length).fill(0x20);
  out.set(encoder.encode(text).subarray(0, length));
  return out;
};

const segmentsOf = (width: number) => Math.ceil(width / 8);

export function writeSav(table: StatTable): Uint8Array {
  const { columns, rowCount } = table;
  const longNames = safeNames(
    columns.map((c) => c.name),
    /[\p{L}\p{N}._$#@]/u,
    64,
    true,
  );
  const shortNames = safeNames(
    longNames.map((n) => n.slice(0, 8).toUpperCase()),
    /[A-Za-z0-9_$#@]/,
    8,
    true,
  );

  // Sizes
  const unitsOf = columns.map((c) => (c.kind === "string" ? segmentsOf(Math.min(c.width, SAV_MAX_TEXT)) : 1));
  const caseUnits = unitsOf.reduce((a, b) => a + b, 0);
  const labelBytes = columns.map((c) => (c.label ? encoder.encode(cutToBytes(c.label, 120)) : null));
  const labelRoom = labelBytes.reduce((a, l) => a + (l ? 4 + Math.ceil(l.length / 4) * 4 : 0), 0);
  const valueLabelBytes = columns.map((c) => (c.valueLabels ?? []).map((v) => ({ value: v.value, bytes: encoder.encode(cutToBytes(v.label, 120)) })));
  const valueLabelRoom = valueLabelBytes.reduce((a, set) => a + (set.length === 0 ? 0 : 8 + set.reduce((s, v) => s + 8 + Math.ceil((1 + v.bytes.length) / 8) * 8, 0) + 12), 0);
  const firstSlot: number[] = [];
  unitsOf.reduce((slot, u, i) => {
    firstSlot[i] = slot;
    return slot + u;
  }, 1);
  const mapping = longNames.map((l, i) => `${shortNames[i]}=${l}`).join("\t");
  const mappingBytes = encoder.encode(mapping);
  const total = 176 + unitsOf.reduce((a, u) => a + u * 32, 0) + labelRoom + valueLabelRoom + (16 + 32) + (16 + 24) + (16 + 5) + (16 + mappingBytes.length) + 8 + rowCount * caseUnits * 8;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let at = 0;
  const i32 = (v: number) => {
    view.setInt32(at, v, true);
    at += 4;
  };
  const f64 = (v: number) => {
    view.setFloat64(at, v, true);
    at += 8;
  };
  const bytes = (b: Uint8Array) => {
    out.set(b, at);
    at += b.length;
  };

  // Header record
  bytes(pad("$FL2", 4));
  bytes(pad("@(#) SPSS DATA FILE - WFRC Synthetic Data Generator", 60));
  i32(2);
  i32(caseUnits);
  i32(0);
  i32(0);
  i32(rowCount);
  f64(100);
  bytes(pad("01 Jan 24", 9));
  bytes(pad("00:00:00", 8));
  bytes(pad("", 64));
  bytes(new Uint8Array(3));

  // Variable records
  columns.forEach((c, i) => {
    let type = 0;
    let format: number;
    switch (c.kind) {
      case "number":
        format = (5 << 16) | (18 << 8) | c.decimals;
        break;
      case "date":
        format = (20 << 16) | (11 << 8);
        break;
      case "datetime":
        format = (22 << 16) | (20 << 8);
        break;
      case "time":
        format = (21 << 16) | (8 << 8);
        break;
      default: {
        type = Math.min(c.width, SAV_MAX_TEXT);
        format = (1 << 16) | (type << 8);
      }
    }
    const label = labelBytes[i];
    i32(2);
    i32(type);
    i32(label ? 1 : 0);
    i32(0);
    i32(format);
    i32(format);
    bytes(pad(shortNames[i], 8));
    if (label) {
      i32(label.length);
      const room = new Uint8Array(Math.ceil(label.length / 4) * 4);
      room.set(label);
      bytes(room);
    }
    for (let k = 1; k < unitsOf[i]; k++) {
      i32(2);
      i32(-1);
      i32(0);
      i32(0);
      i32(0);
      i32(0);
      bytes(pad("", 8));
    }
  });

  // Value labels: one set of codes and labels per labelled variable
  valueLabelBytes.forEach((set, i) => {
    if (set.length === 0) return;
    i32(3);
    i32(set.length);
    for (const v of set) {
      f64(v.value);
      const room = new Uint8Array(Math.ceil((1 + v.bytes.length) / 8) * 8);
      room[0] = v.bytes.length;
      room.set(v.bytes, 1);
      bytes(room);
    }
    i32(4);
    i32(1);
    i32(firstSlot[i]);
  });

  // Extension records: integer info (UTF-8), floating-point info, encoding, long variable names
  i32(7);
  i32(3);
  i32(4);
  i32(8);
  for (const v of [1, 0, 0, -1, 1, 1, 2, 65001]) i32(v);
  i32(7);
  i32(4);
  i32(8);
  i32(3);
  f64(SYSMIS);
  f64(HIGHEST);
  f64(LOWEST);
  i32(7);
  i32(20);
  i32(1);
  i32(5);
  bytes(encoder.encode("UTF-8"));
  i32(7);
  i32(13);
  i32(1);
  i32(mappingBytes.length);
  bytes(mappingBytes);

  // End of the dictionary
  i32(999);
  i32(0);

  // Cases
  for (let r = 0; r < rowCount; r++) {
    columns.forEach((c, i) => {
      const v = c.values[r];
      if (c.kind === "string") {
        const width = unitsOf[i] * 8;
        const cell = new Uint8Array(width).fill(0x20);
        if (typeof v === "string") cell.set(encoder.encode(v).subarray(0, width));
        bytes(cell);
        return;
      }
      if (v === null || typeof v !== "number") {
        f64(SYSMIS);
        return;
      }
      switch (c.kind) {
        case "date":
          f64(v * 86_400 + SPSS_EPOCH_SECONDS);
          break;
        case "datetime":
          f64(v + SPSS_EPOCH_SECONDS);
          break;
        default:
          f64(v);
      }
    });
  }
  return out;
}
