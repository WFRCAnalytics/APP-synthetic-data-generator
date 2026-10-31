// Invented social-security-style numbers (specs/002 research R8). Area numbers 900 to 999 are never
// assigned to a real person, so no invented number is a real one. Shown only after the user
// acknowledges it on the card; the shape (999-99-9999 or 999999999) comes from the real column.

import type { PersonalFormat } from "../spec/types";
import type { Composer } from "./personal";
import { mixedRadix } from "./compose";

export const DEFAULT_SSN_SHAPE = "999-99-9999";

export function makeSsnComposer(format?: PersonalFormat): Composer {
  const shape = format?.shape && (format.shape.match(/9/g) ?? []).length === 9 ? format.shape : DEFAULT_SSN_SHAPE;
  const AREAS = 100; // 900 to 999
  const GROUPS = 99; // 01 to 99
  const SERIALS = 9999; // 0001 to 9999
  return {
    natural: AREAS * GROUPS * SERIALS,
    suffixes: false,
    valueAt(index) {
      const [a, g, s] = mixedRadix(index, [AREAS, GROUPS, SERIALS]);
      const digits = `${900 + a}${String(g + 1).padStart(2, "0")}${String(s + 1).padStart(4, "0")}`;
      let i = 0;
      return shape.replace(/9/g, () => digits[i++]);
    },
  };
}
