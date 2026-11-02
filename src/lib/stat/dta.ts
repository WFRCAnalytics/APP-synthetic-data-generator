// A Stata data file (.dta), format 118, little-endian, UTF-8 (specs/018). Written from typed columns; no value
// labels, notes or other metadata. Numbers are doubles; dates are days since 1960-01-01 (%td), date and times
// milliseconds since 1960-01-01 (%tc); text is a fixed-width str# column.

import { safeNames, type StatTable } from "./table";

/** The longest text one Stata str# column holds. */
export const DTA_MAX_TEXT = 2045;

const MISSING_DOUBLE_HIGH = 0x7fe00000; // the high word of Stata's "." for a double
/** Days from 1960-01-01 to 1970-01-01. */
const STATA_EPOCH_DAYS = 3653;

const encoder = new TextEncoder();
const ascii = (text: string) => encoder.encode(text);

const padded = (text: string, length: number): Uint8Array => {
  const out = new Uint8Array(length);
  out.set(encoder.encode(text).subarray(0, length - 1));
  return out;
};

export function writeDta(table: StatTable): Uint8Array {
  const { columns, rowCount } = table;
  const k = columns.length;
  const names = safeNames(
    columns.map((c) => c.name),
    /[A-Za-z0-9_]/,
    32,
    false,
  );
  const widthOf = (i: number) => (columns[i].kind === "string" ? Math.min(columns[i].width, DTA_MAX_TEXT) : 8);
  const rowSize = columns.reduce((a, _c, j) => a + widthOf(j), 0);

  const u16 = (v: number) => {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, true);
    return b;
  };
  const u64 = (v: number) => {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(v), true);
    return b;
  };
  const cat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };
  const tag = (name: string, body: Uint8Array) => cat(ascii(`<${name}>`), body, ascii(`</${name}>`));

  const header = cat(
    ascii("<stata_dta><header>"),
    tag("release", ascii("118")),
    tag("byteorder", ascii("LSF")),
    tag("K", u16(k)),
    tag("N", u64(rowCount)),
    tag("label", u16(0)),
    tag("timestamp", new Uint8Array([0])),
    ascii("</header>"),
  );

  const types = tag(
    "variable_types",
    cat(
      ...columns.map((c, i) => u16(c.kind === "string" ? widthOf(i) : 65526)), // double
    ),
  );
  const varnames = tag("varnames", cat(...names.map((n) => padded(n, 129))));
  const sortlist = tag("sortlist", new Uint8Array((k + 1) * 2));
  const formats = tag(
    "formats",
    cat(
      ...columns.map((c, i) => {
        switch (c.kind) {
          case "date":
            return padded("%td", 57);
          case "datetime":
            return padded("%tc", 57);
          case "time":
            return padded("%tcHH:MM:SS", 57);
          case "string":
            return padded(`%${widthOf(i)}s`, 57);
          default:
            return padded("%10.0g", 57);
        }
      }),
    ),
  );
  const valueLabelNames = tag("value_label_names", new Uint8Array(k * 129));
  const variableLabels = tag("variable_labels", new Uint8Array(k * 321));
  const characteristics = ascii("<characteristics></characteristics>");

  const data = new Uint8Array(rowCount * rowSize);
  const view = new DataView(data.buffer);
  let at = 0;
  for (let r = 0; r < rowCount; r++) {
    columns.forEach((c, i) => {
      const v = c.values[r];
      if (c.kind === "string") {
        if (typeof v === "string") data.set(encoder.encode(v).subarray(0, widthOf(i)), at);
        at += widthOf(i);
        return;
      }
      if (v === null || typeof v !== "number") {
        view.setUint32(at + 4, MISSING_DOUBLE_HIGH, true);
      } else if (c.kind === "date") {
        view.setFloat64(at, v + STATA_EPOCH_DAYS, true);
      } else if (c.kind === "datetime" || c.kind === "time") {
        const base = c.kind === "datetime" ? STATA_EPOCH_DAYS * 86_400 : 0;
        view.setFloat64(at, (v + base) * 1000, true);
      } else {
        view.setFloat64(at, v, true);
      }
      at += 8;
    });
  }
  const dataSection = tag("data", data);
  const strls = ascii("<strls></strls>");
  const valueLabels = ascii("<value_labels></value_labels>");
  const close = ascii("</stata_dta>");

  const mapSize = "<map>".length + 14 * 8 + "</map>".length;
  const offsets: number[] = [];
  let pos = 0;
  offsets.push(0); // <stata_dta>
  pos += header.length;
  offsets.push(pos); // <map>
  pos += mapSize;
  for (const section of [types, varnames, sortlist, formats, valueLabelNames, variableLabels, characteristics, dataSection, strls, valueLabels]) {
    offsets.push(pos);
    pos += section.length;
  }
  offsets.push(pos); // </stata_dta>
  pos += close.length;
  offsets.push(pos); // end of file
  const map = tag("map", cat(...offsets.map(u64)));

  return cat(header, map, types, varnames, sortlist, formats, valueLabelNames, variableLabels, characteristics, dataSection, strls, valueLabels, close);
}
