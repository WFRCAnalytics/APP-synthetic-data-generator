// Building invented values from an index (specs/002 research R1 to R3). A value is a pure function of a
// position in a space of possible values, so two different positions can never give the same value and
// nothing has to remember what was already made. Groups of identical real values are sent to
// positions through a keyed bijection; when a column needs more distinct values than the space holds,
// the space grows by a numeric suffix instead of repeating.

import { makePermutation, makePermutationBig } from "../rng/permute";
import { mix32 } from "../rng/sfc32";

const TWO_32 = 2 ** 32;

/** The digits of `index` in a mixed radix, most significant first. `index` must be below the product of the radices. */
export function mixedRadix(index: number, radices: readonly number[]): number[] {
  const digits = new Array<number>(radices.length);
  let rest = index;
  for (let i = radices.length - 1; i >= 0; i--) {
    digits[i] = rest % radices[i];
    rest = Math.floor(rest / radices[i]);
  }
  return digits;
}

export interface UniqueSpace {
  /** Size of the natural space (values that need no suffix). */
  natural: number;
  /** Positions available, a whole number of passes over the natural space. */
  total: number;
  /** True when some groups need a suffix because the natural space is too small. */
  suffixNeeded: boolean;
  /** The natural index and the suffix (0 for none) of a group. Distinct groups never share both. */
  map(group: number): { index: number; suffix: number };
}

/**
 * Maps group numbers to unique (natural index, suffix) pairs through a keyed bijection. With enough
 * natural positions no suffix is used; otherwise positions wrap around the natural space and the number
 * of the pass becomes the suffix. Spaces up to 2^53 are supported.
 */
export function makeUniqueSpace(natural: number, groups: number, key: number): UniqueSpace {
  if (!Number.isSafeInteger(natural) || natural < 1)
    throw new RangeError("The natural space must be a positive whole number.");
  const passes = Math.max(1, Math.ceil(groups / natural));
  const total = natural * passes;
  if (!Number.isSafeInteger(total)) throw new RangeError("The space is too large.");
  const permKey = mix32((key ^ 0x7e57da7a) >>> 0);

  let permute: (g: number) => number;
  if (groups === 0) permute = () => 0;
  else if (total <= TWO_32) permute = makePermutation(total, permKey);
  else {
    const big = makePermutationBig(BigInt(total), permKey);
    permute = (g) => Number(big(BigInt(g)));
  }

  return {
    natural,
    total,
    suffixNeeded: passes > 1,
    map(group) {
      const position = permute(group);
      return { index: position % natural, suffix: Math.floor(position / natural) };
    },
  };
}

/** The suffix of a value as text, for kinds that append it to a word: "", " 2", " 3". */
export const suffixText = (suffix: number): string => (suffix === 0 ? "" : ` ${suffix + 1}`);
