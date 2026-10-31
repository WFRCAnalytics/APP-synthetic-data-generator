// One column's generator: a pure function from a row number to the text written in that cell.
// Everything it needs comes from the spec, never from real data (constitution Principle II), and
// every draw depends only on (seed, column name, row) so changing one column never changes another
// and the output does not depend on chunk size (FR-021, research.md R5).

import { effectiveCounts } from "../protections";
import { subSeed } from "../rng/subseed";
import type { ColumnSpec } from "../spec/types";
import { makeLabelLookup } from "./categorical";
import { makeDateFormatter } from "./datetime";
import { formatNumber, makeNumericSource } from "./numeric";
import { makePlacer } from "./placement";

export interface ColumnContext {
  seed: number;
  nRows: number;
}

export interface ColumnGen {
  name: string;
  /** The name written in the header (differs only when the column was renamed). */
  outputName: string;
  /** Whether the source quoted this column's fields (used by per-column quoting). */
  quoted: boolean;
  spec: ColumnSpec;
  valueAt: (row: number) => string;
}

export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationError";
  }
}

/** The text a column writes for NA: its first recorded token, or an empty field. */
export const naTokenOf = (col: ColumnSpec): string => col.na?.tokens[0] ?? "";

export function createColumnGen(col: ColumnSpec, ctx: ColumnContext): ColumnGen {
  const key = subSeed(ctx.seed, col.name);
  const base = { name: col.name, outputName: col.output_name ?? col.name, quoted: col.quoted ?? false, spec: col };
  const gen = (valueAt: (row: number) => string): ColumnGen => ({ ...base, valueAt });

  switch (col.type) {
    case "empty":
    case "unsupported": {
      // Empty columns are all NA; an unsupported column kept "as all-NA" writes the same.
      const token = naTokenOf(col);
      return gen(() => token);
    }

    case "categorical":
    case "boolean": {
      const placer = makePlacer(ctx.nRows, key, col.na, col.sentinels);
      const lookup = makeLabelLookup(effectiveCounts(col.counts, col));
      if (lookup.total !== placer.valueTotal) {
        throw new GenerationError(`Column "${col.name}": category counts (${lookup.total}) do not match the ${placer.valueTotal} rows left after NA and sentinels.`);
      }
      return gen((row) => {
        const p = placer(row);
        return p.kind === "value" ? lookup.at(p.index) : p.token;
      });
    }

    case "integer":
    case "float": {
      const placer = makePlacer(ctx.nRows, key, col.na, col.sentinels);
      const source = makeNumericSource(col, key, placer.valueTotal);
      const format = { integer: col.type === "integer", decimals: col.decimals ?? 0, thousands: col.thousands ?? false, scientific: col.scientific ?? false };
      return gen((row) => {
        const p = placer(row);
        return p.kind === "value" ? formatNumber(source(row, p.index), format) : p.token;
      });
    }

    case "date":
    case "datetime":
    case "time": {
      const placer = makePlacer(ctx.nRows, key, col.na, col.sentinels);
      const source = makeNumericSource(col, key, placer.valueTotal);
      const fmt = makeDateFormatter(col.format, col.granularity);
      return gen((row) => {
        const p = placer(row);
        if (p.kind !== "value") return p.token;
        // Rounding can step outside the real range by less than a unit; keep min and max exact.
        const n = Math.min(col.max, Math.max(col.min, fmt.round(source(row, p.index))));
        return fmt.format(n);
      });
    }

    case "survey_id":
      throw new GenerationError(`Column "${col.name}": survey ID generation is not available yet.`);
  }
}
