// The workbook output of a spec whose source is a sheet (specs/003 FR-011, FR-012): the same table plan
// as for a CSV, written as cells. The layout (sheet name, rows above the header, column kinds and
// number formats) comes from the spec; the values are the generated texts. Pure code, so it is tested
// in Node; the generating worker only forwards the bytes.

import { cellKindOf, workbookChunks, type XlsxLayout } from "../xlsx/writer";
import { EMPTY_TEXT_TOKEN, type SpecFile } from "../spec/types";
import { planTable, rowValues, type TablePlan } from "./table";

/** The layout of the fake sheet for a spec with a sheet source. */
export function xlsxLayoutOf(spec: SpecFile, plan: TablePlan): XlsxLayout {
  const source = spec.source;
  if (source.format !== "xlsx") throw new Error("This spec is not for a workbook.");
  return {
    sheet: source.sheet,
    skipRows: source.skip_rows,
    header: source.header,
    date1904: source.date1904,
    nRows: plan.nRows,
    columns: plan.columns.map((c) => ({ name: c.outputName, kind: cellKindOf(c.spec), ...(c.spec.cell_format ? { format: c.spec.cell_format } : {}) })),
  };
}

/** A preview row as text: an empty-text cell shows as empty. */
export const previewCells = (values: string[]): string[] => values.map((v) => (v === EMPTY_TEXT_TOKEN ? "" : v));

export interface WorkbookRun {
  /** The bytes of the workbook, as they are produced. */
  chunks: AsyncGenerator<Uint8Array>;
  plan: TablePlan;
}

/**
 * Starts writing the workbook for a spec. `observe` sees every row's texts (the check table is measured
 * from them), `between` runs after every `chunkRows` rows (progress, letting a cancel through; it may throw).
 */
export function writeWorkbook(spec: SpecFile, seed: number, chunkRows: number, observe?: (values: string[]) => void, between?: (rowsDone: number) => Promise<void> | void): WorkbookRun {
  const plan = planTable(spec, seed);
  const layout = xlsxLayoutOf(spec, plan);
  const size = Math.max(1, Math.floor(chunkRows));

  async function* rows(): AsyncGenerator<string[]> {
    for (let row = 0; row < plan.nRows; row++) {
      const values = rowValues(plan, row);
      observe?.(values);
      yield values;
      if ((row + 1) % size === 0 || row + 1 === plan.nRows) await between?.(row + 1);
    }
  }

  return { chunks: workbookChunks(layout, rows()), plan };
}
