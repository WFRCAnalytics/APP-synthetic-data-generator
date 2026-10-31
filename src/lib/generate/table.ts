// Assembles the fake table from a spec alone (constitution Principle II: generation never reads
// real data). Excluded columns are dropped, or kept as all-NA when the user asked for that (FR-012).

import { DEFAULT_DIALECT, formatRow, type CsvDialect } from "../csv/writer";
import type { Encoding } from "../encoding/detect";
import type { ColumnSpec, SourceSpec, SpecFile } from "../spec/types";
import { createColumnGen, naTokenOf, type ColumnGen } from "./column";

export interface TablePlan {
  nRows: number;
  seed: number;
  header: string[];
  columns: ColumnGen[];
  quotedFlags: boolean[];
  dialect: CsvDialect;
  headerQuoted: boolean;
  encoding: Encoding;
  bom: boolean;
}

/** The CSV dialect recorded in the spec, with defaults for fields it leaves out. */
export function dialectOf(source: SourceSpec): CsvDialect {
  return {
    delimiter: source.delimiter,
    quote: source.quote === undefined ? DEFAULT_DIALECT.quote : source.quote,
    quoteStyle: source.quote_style ?? DEFAULT_DIALECT.quoteStyle,
    lineEnding: source.line_ending ?? DEFAULT_DIALECT.lineEnding,
    header: source.header,
    trailingNewline: source.trailing_newline ?? DEFAULT_DIALECT.trailingNewline,
  };
}

/** Plans the output table. `seed` overrides the spec's seed (the Generate screen's seed field). */
export function planTable(spec: SpecFile, seed: number = spec.seed): TablePlan {
  const ctx = { seed, nRows: spec.n_rows };
  const columns: ColumnGen[] = [];

  for (const col of spec.columns) {
    const mode = col.exclude ?? "include";
    if (mode === "drop") continue;
    if (mode === "keep_as_na") {
      const asNa = { name: col.name, output_name: col.output_name, quoted: col.quoted, type: "empty", na: { tokens: [naTokenOf(col)], count: spec.n_rows } } as ColumnSpec;
      columns.push(createColumnGen(asNa, ctx));
    } else columns.push(createColumnGen(col, ctx));
  }

  return {
    nRows: spec.n_rows,
    seed,
    header: columns.map((c) => c.outputName),
    columns,
    quotedFlags: columns.map((c) => c.quoted),
    dialect: dialectOf(spec.source),
    headerQuoted: spec.source.header_quoted ?? false,
    encoding: spec.source.encoding,
    bom: spec.source.bom ?? false,
  };
}

/** The cell texts of one row. */
export function rowValues(plan: TablePlan, row: number): string[] {
  const out = new Array<string>(plan.columns.length);
  for (let c = 0; c < plan.columns.length; c++) out[c] = plan.columns[c].valueAt(row);
  return out;
}

/** The header line, or an empty string for a file without a header. */
export function formatHeader(plan: TablePlan): string {
  if (!plan.dialect.header) return "";
  return formatRow(plan.header, plan.dialect, plan.header.map(() => plan.headerQuoted));
}

/**
 * Data rows [start, end) as CSV text, each ending in the file's line ending. `observe` sees each
 * row's cell texts, so the check table can be measured while the rows are produced.
 */
export function formatRows(plan: TablePlan, start: number, end: number, observe?: (values: string[]) => void): string {
  let text = "";
  const last = Math.min(end, plan.nRows);
  for (let row = start; row < last; row++) {
    const values = rowValues(plan, row);
    observe?.(values);
    text += formatRow(values, plan.dialect, plan.quotedFlags);
  }
  return text;
}
