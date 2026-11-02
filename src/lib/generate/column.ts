// One column's generator: a pure function from a row number to the text written in that cell.
// Everything it needs comes from the spec, never from real data (constitution Principle II), and
// every draw depends only on (seed, column name, row) so changing one column never changes another
// and the output does not depend on chunk size (FR-021, research.md R5).

import { effectiveCounts } from "../protections";
import { makePermutation } from "../rng/permute";
import { subSeed } from "../rng/subseed";
import type { CategoricalColumn, ChildCount, ColumnSpec, IdLink, NumericColumn, ParentValue, SurveyIdColumn } from "../spec/types";
import { makeLabelLookup } from "./categorical";
import { makeDateFormatter } from "./datetime";
import { formatNumber, makeNumericSource, withRescale, type NumericPlan } from "./numeric";
import { mix32 } from "../rng/sfc32";
import { makeUniqueSpace } from "../textgen/compose";
import { loremText } from "../textgen/lorem";
import { makeShortStringGenerator, ShortStringError } from "../textgen/shortstring";
import { makePersonalComposer } from "../textgen/personal";
import { groupSizes, makeGroupMapper } from "./groups";
import { makePlacer } from "./placement";
import { IdPatternError, makeIdGenerator, rowsCovered } from "./survey-id";

export interface ColumnContext {
  seed: number;
  nRows: number;
  /** The columns of the table, for a column that needs another one beside it. */
  columns?: readonly ColumnSpec[];
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
/**
 * A whole-number column that is, for each ID of this table, how many rows another table has for that ID (specs/026). The other
 * table sends each of its groups of equal IDs to a different row of this one (the keyed bijection it uses for linked IDs), so the
 * count of a row is the size of the group sent there, or none when no group is.
 */
function childCountColumn(col: NumericColumn, cc: ChildCount, ctx: ColumnContext, gen: (valueAt: (row: number) => string) => ColumnGen): ColumnGen {
  const rows = ctx.nRows;
  if (cc.child.groups !== rows) throw new GenerationError(`Column "${col.name}": the other table draws from ${cc.child.groups} IDs but this table has ${rows} rows.`);
  const sizes = groupSizes(cc.child.repeat_structure);
  if (sizes.length > rows) throw new GenerationError(`Column "${col.name}": the other table has more distinct IDs than this table has rows.`);
  const pick = makePermutation(rows, mix32((subSeed(cc.child.seed, cc.child.column) ^ 0x1ced1ced) >>> 0));
  const sentTo = new Int32Array(rows).fill(-1);
  for (let k = 0; k < sizes.length; k++) sentTo[pick(k)] = k;
  // Rows are placed by a keyed permutation, so the ID of a row is found through the same placement the ID column uses.
  const place = makePlacer(rows, subSeed(ctx.seed, cc.column), undefined, undefined);
  return gen((row) => {
    const p = place(row);
    const group = p.kind === "value" ? sentTo[p.index] : -1;
    return String(group >= 0 ? sizes[group] : 0);
  });
}

/**
 * A categorical column that takes the value the other table's column has in the row with the same ID (specs/030). This table's ID
 * column (`via`) sends each of its groups to a group of the other table's IDs; the other table's ID column holds one new ID per
 * row, placed by a keyed permutation, so the row of a group is the inverse of that permutation. The value of that row is made again
 * from the other table's seed and the labels and counts kept in the spec.
 */
function parentValueColumn(col: CategoricalColumn, fp: ParentValue, ctx: ColumnContext, gen: (valueAt: (row: number) => string) => ColumnGen): ColumnGen {
  const via = ctx.columns?.find((c) => c.name === fp.via);
  if (!via || via.type !== "survey_id" || !via.link) throw new GenerationError(`Column "${col.name}": "${fp.via}" does not use another table's IDs.`);
  const { link, parent } = { link: via.link, parent: fp.parent };
  if (link.groups !== parent.rows) throw new GenerationError(`Column "${col.name}": the other table has ${parent.rows} rows but "${via.name}" draws from ${link.groups} IDs.`);
  const viaKey = subSeed(ctx.seed, via.name);
  const placer = makePlacer(ctx.nRows, viaKey, via.na, via.sentinels);
  if (rowsCovered(via.repeat_structure) !== placer.valueTotal) throw new GenerationError(`Column "${col.name}": the repeat structure of "${via.name}" does not cover its rows.`);
  const own = makeGroupMapper(via.repeat_structure);
  if (own.groups > link.groups) throw new GenerationError(`Column "${col.name}": "${via.name}" has more distinct IDs than the other table makes.`);
  const pick = makePermutation(link.groups, mix32((viaKey ^ 0x1ced1ced) >>> 0));
  // The other table's ID column places its rows by this keyed permutation; the row of a group is found by inverting it.
  const idPlace = makePermutation(parent.rows, mix32((subSeed(parent.seed, parent.id_column) ^ 0xa5a5a5a5) >>> 0));
  const rowOf = new Int32Array(parent.rows);
  for (let r = 0; r < parent.rows; r++) rowOf[idPlace(r)] = r;
  const theirPlacer = makePlacer(parent.rows, subSeed(parent.seed, parent.column), parent.na, parent.sentinels);
  const lookup = makeLabelLookup(parent.counts);
  if (lookup.total !== theirPlacer.valueTotal) throw new GenerationError(`Column "${col.name}": the other table's counts (${lookup.total}) do not match its ${theirPlacer.valueTotal} rows left after NA and sentinels.`);
  return gen((row) => {
    const p = placer(row);
    if (p.kind !== "value") return p.token;
    const q = theirPlacer(rowOf[pick(own(p.index))]);
    return q.kind === "value" ? lookup.at(q.index) : q.token;
  });
}

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
      if (col.from_parent) return parentValueColumn(col, col.from_parent, ctx, gen);
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
      if (col.child_count) return childCountColumn(col, col.child_count, ctx, gen);
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
