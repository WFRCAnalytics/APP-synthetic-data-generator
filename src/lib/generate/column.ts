// One column's generator: a pure function from a row number to the text written in that cell.
// Everything it needs comes from the spec, never from real data (constitution Principle II), and
// every draw depends only on (seed, column name, row) so changing one column never changes another
// and the output does not depend on chunk size (FR-021, research.md R5).

import { effectiveCounts } from "../protections";
import { makePermutation } from "../rng/permute";
import { subSeed } from "../rng/subseed";
import type { ColumnSpec, IdLink, SurveyIdColumn } from "../spec/types";
import { makeLabelLookup } from "./categorical";
import { makeDateFormatter } from "./datetime";
import { formatNumber, makeNumericSource, withRescale, type NumericPlan } from "./numeric";
import { mix32 } from "../rng/sfc32";
import { makeUniqueSpace } from "../textgen/compose";
import { loremText } from "../textgen/lorem";
import { makeShortStringGenerator, ShortStringError } from "../textgen/shortstring";
import { makePersonalComposer } from "../textgen/personal";
import { makeGroupMapper } from "./groups";
import { makePlacer } from "./placement";
import { IdPatternError, makeIdGenerator, rowsCovered } from "./survey-id";

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

/** A numeric source, rescaled to the exact mean and sd when the user asked for that. */
function numericSourceFor(col: NumericPlan & { rescale?: boolean }, key: number, placer: ReturnType<typeof makePlacer>, nRows: number) {
  const source = makeNumericSource(col, key, placer.valueTotal);
  const wantsRescale = col.rescale === true && col.mode === "match_mean_sd" && col.mean !== undefined && col.sd !== undefined && col.max > col.min;
  return wantsRescale ? withRescale(source, placer, nRows, { mean: col.mean as number, sd: col.sd as number, min: col.min, max: col.max }) : source;
}

/**
 * A survey ID column that uses another table's IDs (specs/019). The other table's IDs are a keyed bijection of its group
 * numbers into the pattern, so the same pattern, seed and column name make them again here. This column keeps its own
 * repeat structure (how many rows share an ID); each of its groups is sent to a different group of the other table, so every
 * ID written exists there and no two groups of this column share one.
 */
function linkedIdColumn(col: SurveyIdColumn, link: IdLink, ctx: ColumnContext, key: number, gen: (valueAt: (row: number) => string) => ColumnGen): ColumnGen {
  const placer = makePlacer(ctx.nRows, key, col.na, col.sentinels);
  if (rowsCovered(col.repeat_structure) !== placer.valueTotal) {
    throw new GenerationError(`Column "${col.name}": the repeat structure covers ${rowsCovered(col.repeat_structure)} rows, but ${placer.valueTotal} rows are left after NA and sentinels.`);
  }
  const own = makeGroupMapper(col.repeat_structure);
  if (own.groups > link.groups) {
    throw new GenerationError(`Column "${col.name}": it has ${own.groups} distinct IDs but the other table's column makes only ${link.groups}.`);
  }
  let theirs;
  try {
    theirs = makeIdGenerator({ mask: link.mask, min: link.min, max: link.max, pad_width: link.pad_width, repeat_structure: { "1": link.groups } }, subSeed(link.seed, link.column));
  } catch (err) {
    if (err instanceof IdPatternError) throw new GenerationError(`Column "${col.name}": ${err.message}`);
    throw err;
  }
  const pick = makePermutation(link.groups, mix32((key ^ 0x1ced1ced) >>> 0));
  return gen((row) => {
    const p = placer(row);
    return p.kind === "value" ? theirs(pick(own(p.index))) : p.token;
  });
}

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
      const source = numericSourceFor(col, key, placer, ctx.nRows);
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
      const source = numericSourceFor(col, key, placer, ctx.nRows);
      const fmt = makeDateFormatter(col.format, col.granularity);
      return gen((row) => {
        const p = placer(row);
        if (p.kind !== "value") return p.token;
        // Rounding can step outside the real range by less than a unit; keep min and max exact.
        const n = Math.min(col.max, Math.max(col.min, fmt.round(source(row, p.index))));
        return fmt.format(n);
      });
    }

    case "personal": {
      const placer = makePlacer(ctx.nRows, key, col.na, col.sentinels);
      const groups = makeGroupMapper(col.repeat_structure);
      if (groups.rows !== placer.valueTotal) {
        throw new GenerationError(`Column "${col.name}": the repeat structure covers ${groups.rows} rows, but ${placer.valueTotal} rows are left after NA and sentinels.`);
      }
      const composer = makePersonalComposer(col.kind, col.format, col.locale);
      if (!composer.suffixes && groups.groups > composer.natural) {
        throw new GenerationError(`Column "${col.name}": ${groups.groups} distinct values are needed but only ${composer.natural} can be invented for this kind.`);
      }
      const space = makeUniqueSpace(composer.natural, groups.groups, key);
      return gen((row) => {
        const p = placer(row);
        if (p.kind !== "value") return p.token;
        const { index, suffix } = space.map(groups(p.index));
        return composer.valueAt(index, suffix);
      });
    }

    case "free_text": {
      // The length of each value is drawn like a number (exact min and max, the chosen mode), then the
      // filler text is made to that length.
      const placer = makePlacer(ctx.nRows, key, col.na, col.sentinels);
      const source = numericSourceFor(col, key, placer, ctx.nRows);
      const textKey = mix32((key ^ 0x7e47) >>> 0);
      return gen((row) => {
        const p = placer(row);
        if (p.kind !== "value") return p.token;
        const length = Math.min(col.max, Math.max(col.min, Math.round(source(row, p.index))));
        return loremText(length, textKey, row, col.line_breaks === true);
      });
    }

    case "short_string": {
      const placer = makePlacer(ctx.nRows, key, col.na, col.sentinels);
      const groups = makeGroupMapper(col.repeat_structure);
      if (groups.rows !== placer.valueTotal) {
        throw new GenerationError(`Column "${col.name}": the repeat structure covers ${groups.rows} rows, but ${placer.valueTotal} rows are left after NA and sentinels.`);
      }
      let strings;
      try {
        strings = makeShortStringGenerator({ pattern: col.pattern, length_groups: col.length_groups }, key);
      } catch (err) {
        if (err instanceof ShortStringError) throw new GenerationError(`Column "${col.name}": ${err.message}`);
        throw err;
      }
      if (strings.groups !== groups.groups) {
        throw new GenerationError(`Column "${col.name}": the length groups hold ${strings.groups} distinct values but the repeat structure has ${groups.groups}.`);
      }
      return gen((row) => {
        const p = placer(row);
        return p.kind === "value" ? strings(groups(p.index)) : p.token;
      });
    }

    case "survey_id": {
      if (col.link) return linkedIdColumn(col, col.link, ctx, key, gen);
      const placer = makePlacer(ctx.nRows, key, col.na, col.sentinels);
      if (rowsCovered(col.repeat_structure) !== placer.valueTotal) {
        throw new GenerationError(`Column "${col.name}": the repeat structure covers ${rowsCovered(col.repeat_structure)} rows, but ${placer.valueTotal} rows are left after NA and sentinels.`);
      }
      let ids;
      try {
        ids = makeIdGenerator({ mask: col.mask, min: col.min, max: col.max, pad_width: col.pad_width, repeat_structure: col.repeat_structure }, key);
      } catch (err) {
        if (err instanceof IdPatternError) throw new GenerationError(`Column "${col.name}": ${err.message}`);
        throw err;
      }
      return gen((row) => {
        const p = placer(row);
        return p.kind === "value" ? ids(p.index) : p.token;
      });
    }
  }
}
