// The fake JSON file (specs/007 research R5, contracts/json-output.md). Pure code: the generating worker feeds it the
// cell texts of each row and sends on the bytes. A key is `null` or left out of a record where the cell is the
// key's missing-value text; which of those cells are left out (exactly the recorded number) is chosen by the key's
// own sub-seed, so changing one key never moves another's.

import { drawUniform } from "../rng/counter";
import { createJsonConverter, jsonString, type JsonConverter } from "./convert";
import type { JsonKind, JsonLayout } from "./types";

export interface JsonColumn {
  /** The key as written. */
  name: string;
  kind: JsonKind;
  /** The cell text that stands for a missing value (the key's NA text). */
  naText: string;
  /** How many cells are missing values in the whole file. */
  naTotal: number;
  /** How many of those are left out of the record (the rest are null). */
  missing: number;
  /** The key's sub-seed. */
  key: number;
}

const MISSING_STREAM = 41;

/** Picks, among the missing-value cells in order, exactly `missing` to leave out (selection sampling). */
export function createMissingPicker(key: number, naTotal: number, missing: number): () => boolean {
  let seen = 0;
  let left = Math.min(missing, naTotal);
  return () => {
    const remaining = naTotal - seen;
    const take = left > 0 && (remaining <= left || drawUniform(key, seen, MISSING_STREAM) * remaining < left);
    seen++;
    if (take) left--;
    return take;
  };
}

const eolOf = (layout: JsonLayout): string => (layout.lineEnding === "crlf" ? "\r\n" : "\n");
const unitOf = (layout: JsonLayout): string => (layout.indent === "tab" ? "\t" : layout.indent === "4" ? "    " : layout.indent === "2" ? "  " : "");

export class JsonWriter {
  private readonly converters: JsonConverter[];
  private readonly pickers: (() => boolean)[];
  private readonly names: string[];
  private readonly eol: string;
  private readonly unit: string;
  private readonly pretty: boolean;
  private records = 0;

  constructor(
    private readonly columns: readonly JsonColumn[],
    private readonly layout: JsonLayout,
  ) {
    this.converters = columns.map((c) => createJsonConverter(c.kind));
    this.pickers = columns.map((c) => createMissingPicker(c.key, c.naTotal, c.missing));
    this.names = columns.map((c) => jsonString(c.name));
    this.eol = eolOf(layout);
    this.unit = unitOf(layout);
    this.pretty = layout.form === "array" && layout.indent !== "compact";
  }

  /** Counts per key of text that could not be written as its kind. */
  unparsed(): number[] {
    return this.converters.map((c) => c.stats.unparsed);
  }

  /** The start of the file: the byte-order mark is added by the caller's encoder, so this is text only. */
  begin(): string {
    if (this.layout.form === "lines") return "";
    return this.pretty ? `[${this.eol}` : "[";
  }

  /** One record, with the separator that goes before it. */
  record(values: readonly string[]): string {
    const props: string[] = [];
    for (let c = 0; c < this.columns.length; c++) {
      const col = this.columns[c];
      const text = values[c];
      let token: string;
      if (col.kind === "object" || col.kind === "array") continue; // never written
      if (text === col.naText) {
        if (this.pickers[c]()) continue; // left out of this record
        token = "null";
      } else token = this.converters[c].token(text);
      props.push(`${this.names[c]}${this.pretty ? ": " : ":"}${token}`);
    }

    let body: string;
    if (!this.pretty) body = `{${props.join(",")}}`;
    else if (props.length === 0) body = `${this.unit}{}`;
    else body = `${this.unit}{${this.eol}${props.map((p) => `${this.unit}${this.unit}${p}`).join(`,${this.eol}`)}${this.eol}${this.unit}}`;

    const first = this.records === 0;
    this.records++;
    if (this.layout.form === "lines") return first ? body : `${this.eol}${body}`;
    return first ? body : `,${this.pretty ? this.eol : ""}${body}`;
  }

  /** The end of the file, with the trailing line break as recorded. */
  end(): string {
    let text = "";
    if (this.layout.form === "array") text += this.pretty ? `${this.eol}]` : "]";
    if (this.layout.trailingNewline) text += this.eol;
    return text;
  }
}

/** The bytes of the byte-order mark. */
export const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
