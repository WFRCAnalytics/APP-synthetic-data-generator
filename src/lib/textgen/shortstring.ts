// Short code-like strings (specs/002 FR-007, research R7a). A value of length L takes the first L
// positions of the column's pattern. The distinct values of each length are laid out through a keyed
// bijection over that length's space, so each length gets exactly its recorded number of distinct
// values and no two groups share a value. Which group has which length is shuffled first, so length is
// independent of how often a value repeats. Pure functions of the group number.

import { maskCapacity, maskValueAt, maskValueAtNumber } from "../mask/mask";
import { makePermutation, makePermutationBig } from "../rng/permute";
import { mix32 } from "../rng/sfc32";
import type { MaskToken } from "../spec/types";

const TWO_32 = 2n ** 32n;
const TWO_53 = BigInt(Number.MAX_SAFE_INTEGER);

export class ShortStringError extends Error {
  constructor(
    readonly length: number,
    readonly allowed: bigint,
    readonly needed: number,
  ) {
    super(`For length ${length} the pattern allows ${allowed} distinct values but the column needs ${needed}.`);
    this.name = "ShortStringError";
  }
}

export interface ShortStringPlan {
  pattern: readonly MaskToken[];
  /** Length (as a string key) to the number of distinct values of that length. */
  length_groups: Record<string, number>;
}

export interface ShortStringGenerator {
  /** The value for a group number (0 to groups - 1). */
  (group: number): string;
  groups: number;
}

export function makeShortStringGenerator(plan: ShortStringPlan, key: number): ShortStringGenerator {
  const lengths = Object.entries(plan.length_groups)
    .map(([l, k]) => ({ length: Number(l), count: k }))
    .filter((x) => x.length > 0 && x.count > 0)
    .sort((a, b) => a.length - b.length);

  const offsets: number[] = [];
  let groups = 0;
  const slots = lengths.map((x) => {
    offsets.push(groups);
    groups += x.count;
    const mask = plan.pattern.slice(0, x.length);
    const capacity = maskCapacity(mask);
    if (BigInt(x.count) > capacity) throw new ShortStringError(x.length, capacity, x.count);
    const slotKey = mix32((key ^ Math.imul(x.length, 0x9e3779b1) ^ 0x5eed) >>> 0);
    const toValue = (index: bigint | number): string => (capacity <= TWO_53 ? maskValueAtNumber(mask as MaskToken[], Number(index)) : maskValueAt(mask, BigInt(index)));
    const permute: (i: number) => bigint | number = capacity <= TWO_32 ? makePermutation(Number(capacity), slotKey) : ((p) => (i: number) => p(BigInt(i)))(makePermutationBig(capacity, slotKey));
    return (i: number) => toValue(permute(i));
  });

  // Shuffle which group has which length, so length does not follow the repeat structure.
  const shuffle = groups > 1 ? makePermutation(groups, mix32((key ^ 0x1e9a7) >>> 0)) : (g: number) => g;

  const generator = ((group: number): string => {
    const g = shuffle(group);
    let lo = 0;
    let hi = lengths.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= g) lo = mid;
      else hi = mid - 1;
    }
    return slots[lo](g - offsets[lo]);
  }) as ShortStringGenerator;
  generator.groups = groups;
  return generator;
}
