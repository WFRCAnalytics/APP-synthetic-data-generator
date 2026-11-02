// A SAS transport file (.xpt), version 5 (specs/025). The format is published (the FDA requires it for submissions), so every SAS
// reader opens it, unlike the .sas7bdat that ReadStat's own writer makes. Written from typed columns: variable labels yes, value
// labels no (SAS keeps those in a format catalog, not in the data file). Names are at most 8 characters, text at most 200 bytes.

import { cutToBytes, safeNames, type StatTable } from "./table";

/** The longest text one version 5 character variable holds. */
export const XPT_MAX_TEXT = 200;

/** Days from 1960-01-01 (the SAS zero) to 1970-01-01. */
const SAS_EPOCH_DAYS = 3653;

const encoder = new TextEncoder();

/** Blank-padded text of exactly this many bytes. */
const field = (text: string, length: number): Uint8Array => {
  const out = new Uint8Array(length).fill(0x20);
  out.set(encoder.encode(text).subarray(0, length));
  return out;
};

const record = (text: string): Uint8Array => field(text, 80);

/** A number as IBM mainframe floating point, eight bytes, big-endian: what a transport file holds. */
export function ibmFloat(value: number): Uint8Array {
  const out = new Uint8Array(8);
  if (value === 0 || !Number.isFinite(value)) return out;
  const sign = value < 0 ? 0x80 : 0;
  const v = Math.abs(value);
  let exponent = Math.floor(Math.log(v) / Math.log(16)) + 1;
  let fraction = v / 16 ** exponent;
  if (fraction >= 1) {
    fraction /= 16;
    exponent++;
  } else if (fraction < 1 / 16) {
    fraction *= 16;
    exponent--;
  }
  let mantissa = BigInt(Math.round(fraction * 2 ** 56));
  if (mantissa >= 1n << 56n) {
    mantissa >>= 4n;
    exponent++;
  }
  const biased = 64 + exponent;
  if (biased < 0 || biased > 127) return out; // out of range: written as zero rather than a wrong number
  out[0] = sign | biased;
  for (let i = 0; i < 7; i++) out[7 - i] = Number((mantissa >> BigInt(8 * i)) & 0xffn);
  return out;
}

const MISSING = (() => {
  const b = new Uint8Array(8);
  b[0] = 0x2e; // "."
  return b;
})();

const STAMP = "01JAN24:00:00:00";

export function writeXpt(table: StatTable): Uint8Array {
  const { columns, rowCount } = table;
  const names = safeNames(
    columns.map((c) => c.name),
    /[A-Za-z0-9_]/,
    8,
    true,
  );
  const widthOf = (i: number) => (columns[i].kind === "string" ? Math.min(columns[i].width, XPT_MAX_TEXT) : 8);
  let offset = 0;
  const positions = columns.map((_, i) => {
    const at = offset;
    offset += widthOf(i);
    return at;
  });
  const rowSize = offset;

  const parts: Uint8Array[] = [];
  const add = (...bytes: Uint8Array[]) => parts.push(...bytes);
  const header = (kind: string, tail = "000000000000000000000000000000  ") => record(`HEADER RECORD*******${kind} HEADER RECORD!!!!!!!${tail}`);

  add(header("LIBRARY"));
  add(record(`SAS     SAS     SASLIB  9.4     W32_VSPR${" ".repeat(24)}${STAMP}`));
  add(record(`${STAMP}${" ".repeat(64)}`));
  add(record("HEADER RECORD*******MEMBER  HEADER RECORD!!!!!!!000000000000000001600000000140  "));
  add(header("DSCRPTR"));
  add(record(`SAS     DATA    SASDATA 9.4     W32_VSPR${" ".repeat(24)}${STAMP}`));
  add(record(`${STAMP}${" ".repeat(16)}${" ".repeat(40)}`));
  add(record(`HEADER RECORD*******NAMESTR HEADER RECORD!!!!!!!000000${String(columns.length).padStart(4, "0")}00000000000000000000  `));

  // One 140-byte description per variable, big-endian
  const namestrs = new Uint8Array(columns.length * 140);
  const view = new DataView(namestrs.buffer);
  columns.forEach((c, i) => {
    const at = i * 140;
    const text = c.kind === "string";
    let format = "";
    let formatLength = 0;
    if (c.kind === "date") [format, formatLength] = ["DATE", 9];
    else if (c.kind === "datetime") [format, formatLength] = ["DATETIME", 19];
    else if (c.kind === "time") [format, formatLength] = ["TIME", 8];
    view.setInt16(at, text ? 2 : 1);
    view.setInt16(at + 4, widthOf(i));
    view.setInt16(at + 6, i + 1);
    namestrs.set(field(names[i], 8), at + 8);
    namestrs.set(field(c.label ? cutToBytes(c.label, 40) : "", 40), at + 16);
    namestrs.set(field(format, 8), at + 56);
    view.setInt16(at + 64, formatLength);
    if (c.kind === "number") view.setInt16(at + 66, c.decimals);
    view.setInt32(at + 84, positions[i]);
  });
  add(namestrs);
  const padding = (80 - ((columns.length * 140) % 80)) % 80;
  add(new Uint8Array(padding).fill(0x20));
  add(header("OBS"));

  // Observations
  const data = new Uint8Array(rowCount * rowSize);
  columns.forEach((c, i) => {
    const width = widthOf(i);
    for (let r = 0; r < rowCount; r++) {
      const at = r * rowSize + positions[i];
      const v = c.values[r];
      if (c.kind === "string") {
        data.fill(0x20, at, at + width);
        if (typeof v === "string") data.set(encoder.encode(v).subarray(0, width), at);
        continue;
      }
      if (v === null || typeof v !== "number") {
        data.set(MISSING, at);
        continue;
      }
      const number = c.kind === "date" ? v + SAS_EPOCH_DAYS : c.kind === "datetime" ? v + SAS_EPOCH_DAYS * 86_400 : v;
      data.set(ibmFloat(number), at);
    }
  });
  add(data);
  const tail = (80 - ((rowCount * rowSize) % 80)) % 80;
  add(new Uint8Array(tail).fill(0x20));

  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
