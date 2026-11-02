// The value labels of an SPSS or Stata file ("1 is Car"), read from the file's own label records (specs/021). DuckDB's reader
// gives the codes but not their labels, so the records are read here. Only the label tables are read, never the data. The
// labels become entries of the same shape a codebook has, so they are kept beside the columns they belong to, matched against
// the values the table really has, and shown on Review and in the README for agents.

import type { CodebookEntry } from "../codebook/codebook";
import { MAX_ENTRIES, MAX_LABEL_LENGTH } from "../codebook/codebook";

/** How much of an SPSS file is read: its dictionary comes before the data and is far smaller than this. */
export const SAV_DICTIONARY_BYTES = 8 * 1024 * 1024;

const latin1 = new TextDecoder("latin1");

/** A number as the text the table holds for it: a whole number without ".0", anything else as it is. */
const numberText = (n: number): string => (Number.isFinite(n) && Number.isInteger(n) ? String(n) : String(n));

const clean = (text: string): string => text.replace(/\0+$/, "").replace(/\s+$/, "").slice(0, MAX_LABEL_LENGTH);

// ---- SPSS ------------------------------------------------------------------------------------

interface SavVariable {
  name: string;
  isString: boolean;
}

/** The labels in the dictionary of an SPSS file (its first bytes), or none when the file does not say. */
export function parseSavLabels(bytes: Uint8Array): CodebookEntry[] {
  if (bytes.length < 180 || !(latin1.decode(bytes.subarray(0, 3)) === "$FL")) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const layout = view.getInt32(64, true);
  const little = layout === 2 || layout === 3;
  const i32 = (at: number) => view.getInt32(at, little);
  const f64 = (at: number) => view.getFloat64(at, little);

  let decoder = new TextDecoder("utf-8");
  const variables: (SavVariable | null)[] = []; // one entry per 8-byte slot; null for the extra slots of a long string
  const sets: { values: string[]; labels: string[]; indexes: number[] }[] = [];
  let longNames = new Map<string, string>();

  let at = 176;
  const room = (n: number) => at + n <= bytes.length;
  while (room(4)) {
    const type = i32(at);
    at += 4;
    if (type === 2) {
      if (!room(28)) break;
      const width = i32(at);
      const hasLabel = i32(at + 4);
      const missing = i32(at + 8);
      const name = decoder.decode(bytes.subarray(at + 20, at + 28)).replace(/\s+$/, "");
      at += 28;
      if (hasLabel !== 0) {
        if (!room(4)) break;
        const length = i32(at);
        at += 4 + Math.ceil(length / 4) * 4;
      }
      at += Math.abs(missing) * 8;
      variables.push(width === -1 ? null : { name, isString: width > 0 });
    } else if (type === 3) {
      if (!room(4)) break;
      const count = i32(at);
      at += 4;
      const values: string[] = [];
      const labels: string[] = [];
      for (let k = 0; k < count; k++) {
        if (!room(9)) return collect();
        const valueAt = at;
        const length = bytes[at + 8];
        const padded = Math.ceil((length + 1) / 8) * 8;
        if (!room(8 + padded)) return collect();
        values.push(`${valueAt}`); // resolved once the variables it belongs to are known
        labels.push(clean(decoder.decode(bytes.subarray(at + 9, at + 9 + length))));
        at += 8 + padded;
      }
      // The next record says which variables use this set of labels.
      if (!room(8) || i32(at) !== 4) break;
      const n = i32(at + 4);
      at += 8;
      if (!room(n * 4)) break;
      const indexes = Array.from({ length: n }, (_, k) => i32(at + k * 4) - 1);
      at += n * 4;
      sets.push({ values, labels, indexes });
    } else if (type === 6) {
      if (!room(4)) break;
      at += 4 + i32(at) * 80;
    } else if (type === 7) {
      if (!room(12)) break;
      const subtype = i32(at);
      const size = i32(at + 4);
      const count = i32(at + 8);
      at += 12;
      if (size < 0 || count < 0 || !room(size * count)) break;
      const data = bytes.subarray(at, at + size * count);
      if (subtype === 3 && data.length >= 32) {
        const code = new DataView(data.buffer, data.byteOffset, data.byteLength).getInt32(28, little);
        decoder = new TextDecoder(code === 65001 ? "utf-8" : "windows-1252");
      } else if (subtype === 13) {
        longNames = new Map(
          decoder
            .decode(data)
            .split("\t")
            .map((pair) => pair.split("="))
            .filter((p): p is [string, string] => p.length === 2)
            .map(([short, long]) => [short.trim(), long.trim()]),
        );
      }
      at += size * count;
    } else {
      break; // 999 ends the dictionary; anything else is not understood
    }
  }
  return collect();

  function collect(): CodebookEntry[] {
    const out: CodebookEntry[] = [];
    for (const set of sets) {
      // The value of each label sits where it was read; read it by the kind of variable that uses the set.
      for (const index of set.indexes) {
        const variable = variables[index];
        if (!variable) continue;
        const column = longNames.get(variable.name) ?? variable.name;
        set.values.forEach((where, k) => {
          const valueAt = Number(where);
          const value = variable.isString ? clean(decoder.decode(bytes.subarray(valueAt, valueAt + 8))) : numberText(f64(valueAt));
          out.push({ column, value, label: set.labels[k] });
        });
        if (out.length >= MAX_ENTRIES) return out.slice(0, MAX_ENTRIES);
      }
    }
    return out;
  }
}

// ---- Stata -----------------------------------------------------------------------------------

/** The labels of a Stata file (format 117 or later), reading only the parts of the file that hold them. */
export async function parseDtaLabels(read: (start: number, end: number) => Promise<Uint8Array>): Promise<CodebookEntry[]> {
  const head = await read(0, 1024);
  const text = latin1.decode(head);
  if (!text.startsWith("<stata_dta>")) return [];
  const release = Number(/<release>(\d+)<\/release>/.exec(text)?.[1] ?? 0);
  if (release < 117) return [];
  const little = !/<byteorder>MSF<\/byteorder>/.test(text);
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);

  const kStart = text.indexOf("<K>") + 3;
  const variableCount = release >= 119 ? view.getUint32(kStart, little) : view.getUint16(kStart, little);
  const mapStart = text.indexOf("<map>") + 5;
  if (kStart < 3 || mapStart < 5 || mapStart + 14 * 8 > head.length) return [];
  const offsets = Array.from({ length: 14 }, (_, i) => Number(view.getBigUint64(mapStart + i * 8, little)));

  const nameWidth = release >= 118 ? 129 : 33;
  const decoder = new TextDecoder(release >= 118 ? "utf-8" : "windows-1252");
  const cstring = (b: Uint8Array) => {
    const end = b.indexOf(0);
    return decoder.decode(end < 0 ? b : b.subarray(0, end));
  };
  const table = async (tag: string, section: number): Promise<string[]> => {
    const start = offsets[section] + tag.length + 2;
    const bytes = await read(start, start + variableCount * nameWidth);
    return Array.from({ length: variableCount }, (_, i) => cstring(bytes.subarray(i * nameWidth, (i + 1) * nameWidth)));
  };
  const varnames = await table("varnames", 3);
  const labelSets = await table("value_label_names", 6);
  if (labelSets.every((s) => s === "")) return [];

  const section = await read(offsets[11] + "<value_labels>".length, offsets[12]);
  const sv = new DataView(section.buffer, section.byteOffset, section.byteLength);
  const bySet = new Map<string, { value: string; label: string }[]>();
  let at = 0;
  while (at + 5 + 4 <= section.length && latin1.decode(section.subarray(at, at + 5)) === "<lbl>") {
    at += 5;
    const length = sv.getInt32(at, little);
    const name = cstring(section.subarray(at + 4, at + 4 + nameWidth));
    const body = at + 4 + nameWidth + 3;
    if (length < 8 || body + length > section.length) break;
    const n = sv.getInt32(body, little);
    const textLength = sv.getInt32(body + 4, little);
    const offsetsAt = body + 8;
    const valuesAt = offsetsAt + n * 4;
    const textAt = valuesAt + n * 4;
    if (n < 0 || textAt + textLength > section.length) break;
    const rows: { value: string; label: string }[] = [];
    for (let k = 0; k < n; k++) {
      const label = cstring(section.subarray(textAt + sv.getInt32(offsetsAt + k * 4, little), textAt + textLength));
      rows.push({ value: String(sv.getInt32(valuesAt + k * 4, little)), label: clean(label) });
    }
    bySet.set(name, rows);
    at = body + length + "</lbl>".length;
  }

  const out: CodebookEntry[] = [];
  varnames.forEach((column, i) => {
    for (const row of bySet.get(labelSets[i]) ?? []) if (out.length < MAX_ENTRIES) out.push({ column, ...row });
  });
  return out;
}

/** The value labels of a chosen file, or none when it has none or they cannot be read. */
export async function readStatLabels(file: File, format: "sav" | "dta"): Promise<CodebookEntry[]> {
  try {
    if (format === "sav") return parseSavLabels(new Uint8Array(await file.slice(0, SAV_DICTIONARY_BYTES).arrayBuffer()));
    return await parseDtaLabels(async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()));
  } catch {
    return [];
  }
}
