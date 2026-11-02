// The JSON output of a spec whose source is a JSON file (specs/007 FR-006, FR-007, research R5): the same table plan as
// for a CSV, written as records. The keys, their order, kinds and layout come from the spec; the values are the
// generated texts, converted to each key's kind. Pure code, so it is tested in Node; the generating worker only
// forwards the bytes.

import type { CheckRow } from "./checks";
import { BOM, JsonWriter, type JsonColumn } from "../json/writer";
import type { JsonLayout } from "../json/types";
import { subSeed } from "../rng/subseed";
import type { SpecFile } from "../spec/types";
import { naTokenOf } from "./column";
import { planTable, rowValues, type TablePlan } from "./table";

/** The form and layout the spec records. */
export function jsonLayoutOf(spec: SpecFile): JsonLayout {
  const s = spec.source;
  if (s.format !== "json") throw new Error("This spec is not for a JSON file.");
  return { form: s.form, indent: s.indent, lineEnding: s.line_ending, trailingNewline: s.trailing_newline, bom: s.bom };
}

/**
 * The keys of the fake file, in the plan's order. A key that is unsupported, empty or kept as all-missing is written
 * as `null` in every record; a key left out of the plan is not written at all.
 */
export function jsonColumnsOf(spec: SpecFile, plan: TablePlan): JsonColumn[] {
  return plan.columns.map((gen) => {
    const original = spec.columns.find((c) => c.name === gen.spec.name);
    const written = original !== undefined && original.type !== "unsupported" && original.type !== "empty" && (original.exclude ?? "include") === "include";
    const kind = written ? (original.json_kind ?? "string") : "null";
    return {
      name: gen.outputName,
      kind,
      naText: original ? naTokenOf(original) : "",
      naTotal: written ? (original.na?.count ?? 0) : plan.nRows,
      missing: written ? Math.min(original.json_missing ?? 0, original.na?.count ?? 0) : 0,
      key: subSeed(plan.seed, gen.spec.name),
    };
  });
}

export interface JsonRun {
  /** The bytes of the file, as they are produced. */
  chunks: AsyncGenerator<Uint8Array>;
  plan: TablePlan;
  columns: JsonColumn[];
  layout: JsonLayout;
  /** After the chunks are consumed: one check row per key that had text it could not write as its kind. */
  extraChecks(): CheckRow[];
}

const CHUNK_TEXT = 1 << 20;

/**
 * Starts writing the file for a spec. `observe` sees every row's texts (the check table is measured from them),
 * `between` runs after every `chunkRows` rows (progress, letting a cancel through; it may throw).
 */
export function writeJson(spec: SpecFile, seed: number, chunkRows: number, observe?: (values: string[]) => void, between?: (rowsDone: number) => Promise<void> | void): JsonRun {
  const plan = planTable(spec, seed);
  const layout = jsonLayoutOf(spec);
  const columns = jsonColumnsOf(spec, plan);
  const writer = new JsonWriter(columns, layout);
  const size = Math.max(1, Math.floor(chunkRows));
  const encoder = new TextEncoder();

  async function* chunks(): AsyncGenerator<Uint8Array> {
    if (layout.bom) yield BOM.slice();
    let text = writer.begin();
    for (let row = 0; row < plan.nRows; row++) {
      const values = rowValues(plan, row);
      observe?.(values);
      text += writer.record(values);
      if (text.length >= CHUNK_TEXT) {
        yield encoder.encode(text);
        text = "";
      }
      if ((row + 1) % size === 0 || row + 1 === plan.nRows) await between?.(row + 1);
    }
    text += writer.end();
    if (text.length > 0) yield encoder.encode(text);
  }

  return {
    chunks: chunks(),
    plan,
    columns,
    layout,
    extraChecks() {
      const out: CheckRow[] = [];
      writer.unparsed().forEach((unparsed, i) => {
        if (unparsed > 0) out.push({ column: columns[i].name, metric: "unparsed", target: "0 values the kind cannot hold", achieved: String(unparsed), pass: false });
      });
      return out;
    },
  };
}
