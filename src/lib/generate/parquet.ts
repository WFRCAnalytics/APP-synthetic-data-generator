// The Parquet output of a spec whose source is a Parquet file (specs/005 FR-006, FR-007, research R6): the
// same table plan as for a CSV, written as typed columns. The names, order and types come from the spec; the
// values are the generated texts, converted to each column's type and clamped into its range. Pure code,
// so it is tested in Node; the generating worker only forwards the bytes.

import type { CheckRow } from "./checks";
import { createConverter, type Converter } from "../parquet/convert";
import { parquetChunks, type Codec, type ParquetColumn } from "../parquet/writer";
import type { ParquetType } from "../parquet/types";
import type { SpecFile } from "../spec/types";
import { planTable, rowValues, type TablePlan } from "./table";

/** A column of nulls under the same name: what a kept-but-unsupported or empty column is written as. */
const NULL_COLUMN: ParquetType = { kind: "string", nullable: true };

/**
 * The columns of the fake file, in the plan's order. A column that is excluded as all-missing, empty or
 * unsupported is written as an optional string column of nulls; a column whose cells include missing
 * values is optional even if the real one was required (it cannot be written otherwise).
 */
export function parquetLayoutOf(spec: SpecFile, plan: TablePlan): ParquetColumn[] {
  if (spec.source.format !== "parquet") throw new Error("This spec is not for a Parquet file.");
  return plan.columns.map((gen) => {
    const original = spec.columns.find((c) => c.name === gen.spec.name);
    const real = original?.parquet_type;
    const written = original && original.type !== "unsupported" && original.type !== "empty" && (original.exclude ?? "include") === "include";
    if (!real || !written) return { name: gen.outputName, type: NULL_COLUMN };
    const missing = (original.na?.count ?? 0) > 0;
    return { name: gen.outputName, type: missing && !real.nullable ? { ...real, nullable: true } : real };
  });
}

export interface ParquetRun {
  /** The bytes of the file, as they are produced. */
  chunks: AsyncGenerator<Uint8Array>;
  plan: TablePlan;
  columns: ParquetColumn[];
  /** The codec the pages are written with. */
  codec: Codec;
  /** After the chunks are consumed: one check row per column that had values clamped or unreadable. */
  extraChecks(): CheckRow[];
}

export interface ParquetRunOptions {
  /** The footer's creator text. */
  createdBy: string;
  codec: Codec;
  rowGroupRows?: number;
}

/**
 * Starts writing the file for a spec. `observe` sees every row's texts (the check table is measured from
 * them), `between` runs after every `chunkRows` rows (progress, letting a cancel through; it may throw).
 */
export function writeParquet(spec: SpecFile, seed: number, chunkRows: number, options: ParquetRunOptions, observe?: (values: string[]) => void, between?: (rowsDone: number) => Promise<void> | void): ParquetRun {
  const plan = planTable(spec, seed);
  const columns = parquetLayoutOf(spec, plan);
  const converters: Converter[] = columns.map((c) => createConverter(c.type));
  const size = Math.max(1, Math.floor(chunkRows));

  async function* rows(): AsyncGenerator<(ReturnType<Converter["convert"]>)[]> {
    for (let row = 0; row < plan.nRows; row++) {
      const values = rowValues(plan, row);
      observe?.(values);
      yield values.map((text, c) => converters[c].convert(text));
      if ((row + 1) % size === 0 || row + 1 === plan.nRows) await between?.(row + 1);
    }
  }

  return {
    chunks: parquetChunks(columns, rows(), { createdBy: options.createdBy, codec: options.codec, rowGroupRows: options.rowGroupRows }),
    plan,
    columns,
    codec: options.codec,
    extraChecks() {
      const out: CheckRow[] = [];
      columns.forEach((c, i) => {
        const { narrowed, unparsed } = converters[i].stats;
        if (narrowed > 0) out.push({ column: c.name, metric: "narrowed", target: "0 values outside the column's type", achieved: String(narrowed), pass: false });
        if (unparsed > 0) out.push({ column: c.name, metric: "unparsed", target: "0 values the type cannot hold", achieved: String(unparsed), pass: false });
      });
      return out;
    },
  };
}
