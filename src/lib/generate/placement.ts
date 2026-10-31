// Places the exact number of NA rows and sentinel rows of a column at random-looking rows, without
// holding a shuffled array in memory (research.md R5, FR-022).
//
// A keyed permutation maps each row to a distinct rank in [0, nRows). Ranks are laid out as
//   [ NA tokens ][ sentinel codes ][ real values ]
// so every count is hit exactly, whatever the row order or chunk size.

import { makePermutation } from "../rng/permute";
import { mix32 } from "../rng/sfc32";

export interface NaPlan {
  tokens: string[];
  count: number;
  by_token?: Record<string, number>;
}

export type Placement =
  | { kind: "na"; token: string }
  | { kind: "sentinel"; token: string }
  /** `index` is the row's rank among the real values, in [0, valueTotal). */
  | { kind: "value"; index: number };

export interface Placer {
  (row: number): Placement;
  /** How many rows hold real values. */
  valueTotal: number;
}

interface Block {
  token: string;
  /** Exclusive end rank of this block. */
  end: number;
}

function blocks(entries: [string, number][], start: number): { list: Block[]; end: number } {
  const list: Block[] = [];
  let end = start;
  for (const [token, n] of entries) {
    if (n <= 0) continue;
    end += n;
    list.push({ token, end });
  }
  return { list, end };
}

function blockFor(list: Block[], rank: number): Block {
  // Few blocks, so a linear scan is as fast as a binary search.
  for (const b of list) if (rank < b.end) return b;
  return list[list.length - 1];
}

/**
 * @param key  the column's sub-seed
 * @param na   NA tokens with counts (one token takes them all when `by_token` is missing)
 * @param sentinels sentinel code to exact count
 */
export function makePlacer(
  nRows: number,
  key: number,
  na: NaPlan | undefined,
  sentinels: Record<string, number> | undefined,
): Placer {
  const naEntries: [string, number][] = na
    ? na.by_token
      ? Object.entries(na.by_token)
      : [[na.tokens[0] ?? "", na.count]]
    : [];
  const naBlocks = blocks(naEntries, 0);
  const sentinelBlocks = blocks(Object.entries(sentinels ?? {}), naBlocks.end);

  const valueStart = sentinelBlocks.end;
  if (valueStart > nRows) throw new RangeError("NA and sentinel counts exceed the row count");
  const valueTotal = nRows - valueStart;

  const perm = nRows > 0 ? makePermutation(nRows, mix32((key ^ 0xa5a5a5a5) >>> 0)) : () => 0;

  const placer = ((row: number): Placement => {
    const rank = perm(row);
    if (rank < naBlocks.end) return { kind: "na", token: blockFor(naBlocks.list, rank).token };
    if (rank < sentinelBlocks.end) return { kind: "sentinel", token: blockFor(sentinelBlocks.list, rank).token };
    return { kind: "value", index: rank - valueStart };
  }) as Placer;
  placer.valueTotal = valueTotal;
  return placer;
}
