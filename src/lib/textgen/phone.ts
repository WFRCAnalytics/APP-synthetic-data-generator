// US phone numbers (specs/002 research R3, R4). The ten digits come from valid area codes and
// exchanges (never 555), and are written in one of the shapes profiled from the real column, such as
// (999) 999-9999 or 999-999-9999. A shape holds punctuation only; the digits are always invented.

import type { PersonalFormat } from "../spec/types";
import type { Composer } from "./personal";
import { mixedRadix } from "./compose";
import { areaCodes, exchangeCodes } from "./wordlists";

export const DEFAULT_PHONE_SHAPE = "(999) 999-9999";

/** Fills the 9s of a shape with digits: 10 digits, or the last 7, or a leading 1 plus 10. */
export function fillShape(shape: string, digits: string): string {
  const slots = (shape.match(/9/g) ?? []).length;
  let use: string;
  if (slots === 11) use = `1${digits}`;
  else if (slots >= 10) use = digits.padStart(slots, "0");
  else use = digits.slice(digits.length - slots);
  let i = 0;
  return shape.replace(/9/g, () => use[i++]);
}

export function makePhoneComposer(format?: PersonalFormat): Composer {
  const shapes =
    format?.shapes && format.shapes.length > 0
      ? format.shapes
      : [{ shape: DEFAULT_PHONE_SHAPE, share: 1 }];
  const total = shapes.reduce((a, s) => a + s.share, 0) || 1;
  const cumulative: number[] = [];
  shapes.reduce((acc, s) => (cumulative.push(acc + s.share / total), acc + s.share / total), 0);

  const LINES = 10000;
  return {
    natural: areaCodes.length * exchangeCodes.length * LINES,
    suffixes: false,
    valueAt(index) {
      const [a, e, line] = mixedRadix(index, [areaCodes.length, exchangeCodes.length, LINES]);
      const digits = `${areaCodes[a]}${exchangeCodes[e]}${String(line).padStart(4, "0")}`;
      // The shape is chosen from the index with a fixed mix, so shares are kept across the column.
      const u = ((Math.imul(index, 2654435761) >>> 0) % 1_000_003) / 1_000_003;
      const k = cumulative.findIndex((c) => u < c);
      return fillShape(shapes[k < 0 ? shapes.length - 1 : k].shape, digits);
    },
  };
}
