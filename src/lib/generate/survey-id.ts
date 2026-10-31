// Survey ID columns (FR-025, research.md R5): new IDs that fit the pattern, with the same repeat
// structure as the real column, and never a real ID.
//
// A row's rank among the column's real values picks its group through the repeat structure (so exactly
// as many IDs appear once, twice, three times as in the source). A keyed bijection then maps each
// group to a different position in the pattern's space, so no two groups share an ID. Everything is
// a pure function of the row, so output does not depend on chunk size.

import { idCapacity, isNumericMask, maskValueAt, maskValueAtNumber } from "../mask/mask";
import { makePermutation, makePermutationBig } from "../rng/permute";
import { mix32 } from "../rng/sfc32";
import type { MaskToken } from "../spec/types";

export interface IdPlan {
  mask: readonly MaskToken[];
  min?: number;
  max?: number;
  pad_width?: number;
  /** Group size (as a string key) to the number of distinct IDs with that size. */
  repeat_structure: Record<string, number>;
}

export interface IdGenerator {
  /** The ID for the row with this rank among the real values. */
  (valueIndex: number): string;
  /** Distinct IDs the column uses. */
  groups: number;
  capacity: bigint;
}

/** How many distinct IDs the repeat structure needs. */
export function groupsNeeded(repeat: Record<string, number>): number {
  return Object.values(repeat).reduce((a, b) => a + b, 0);
}

/** How many rows the repeat structure covers. */
export function rowsCovered(repeat: Record<string, number>): number {
  return Object.entries(repeat).reduce((sum, [size, n]) => sum + Number(size) * n, 0);
}

export class IdPatternError extends Error {
  constructor(
    readonly allowed: bigint,
    readonly needed: number,
  ) {
    super(`The ID pattern allows ${allowed} distinct values but the column needs ${needed}.`);
    this.name = "IdPatternError";
  }
}

const TWO_32 = 2n ** 32n;
const TWO_53 = BigInt(Number.MAX_SAFE_INTEGER);

export function makeIdGenerator(plan: IdPlan, key: number): IdGenerator {
  const buckets = Object.entries(plan.repeat_structure)
    .map(([size, count]) => ({ size: Number(size), count }))
    .filter((b) => b.size > 0 && b.count > 0)
    .sort((a, b) => a.size - b.size);

  // Where each size's block of rows and block of groups starts.
  const rowStart: number[] = [];
  const groupStart: number[] = [];
  let rows = 0;
  let groups = 0;
  for (const b of buckets) {
    rowStart.push(rows);
    groupStart.push(groups);
    rows += b.size * b.count;
    groups += b.count;
  }

  const capacity = idCapacity(plan.mask, plan.min, plan.max);
  if (BigInt(groups) > capacity) throw new IdPatternError(capacity, groups);

  const permKey = mix32((key ^ 0x1d1d1d1d) >>> 0);
  const small = capacity <= TWO_32;
  const permute = groups === 0 ? () => 0n : small ? ((p) => (g: number) => BigInt(p(g)))(makePermutation(Number(capacity), permKey)) : ((p) => (g: number) => p(BigInt(g)))(makePermutationBig(capacity, permKey));

  const numeric = isNumericMask(plan.mask) && plan.min !== undefined && plan.max !== undefined && plan.max >= plan.min;
  const pad = plan.pad_width ?? 0;
  const exact = capacity <= TWO_53;

  const idOf = (index: bigint): string => {
    if (numeric) {
      const n = BigInt(plan.min as number) + index;
      return pad > 0 ? n.toString().padStart(pad, "0") : n.toString();
    }
    return exact ? maskValueAtNumber(plan.mask as MaskToken[], Number(index)) : maskValueAt(plan.mask, index);
  };

  const generator = ((valueIndex: number): string => {
    // The block of rows this rank falls in, then the group within it.
    let lo = 0;
    let hi = buckets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rowStart[mid] <= valueIndex) lo = mid;
      else hi = mid - 1;
    }
    const group = groupStart[lo] + Math.floor((valueIndex - rowStart[lo]) / buckets[lo].size);
    return idOf(permute(group));
  }) as IdGenerator;
  generator.groups = groups;
  generator.capacity = capacity;
  return generator;
}

/** A few example IDs for the pattern editor. They are invented, so showing them is safe. */
export function sampleIds(mask: readonly MaskToken[], count: number, min?: number, max?: number, pad?: number): string[] {
  const capacity = idCapacity(mask, min, max);
  const n = Number(capacity < BigInt(count) ? capacity : BigInt(count));
  if (n <= 0 || mask.length === 0) return [];
  const generate = makeIdGenerator({ mask, min, max, pad_width: pad, repeat_structure: { "1": n } }, 7);
  return Array.from({ length: n }, (_, i) => generate(i));
}
