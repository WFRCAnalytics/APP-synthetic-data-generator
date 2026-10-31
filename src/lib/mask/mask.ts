// The ID pattern model (FR-014, FR-016): what characters each position of a survey ID may hold, how
// many distinct IDs a pattern allows, and how a number maps to an ID of that pattern. No ID value is
// ever stored; a pattern is a list of tokens (constitution Principle II).

import type { MaskToken } from "../spec/types";

const DIGITS = "0123456789";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";

/** The characters a token may hold, in a fixed order. */
export function alphabetOf(token: MaskToken): string {
  if (typeof token === "object") return token.literal;
  switch (token) {
    case "digit":
      return DIGITS;
    case "upper":
      return UPPER;
    case "lower":
      return LOWER;
    case "letter":
      return UPPER + LOWER;
    case "alnum":
      return DIGITS + UPPER + LOWER;
  }
}

export const isLiteral = (t: MaskToken): t is { literal: string } => typeof t === "object";

/** True when every position is a digit, so the ID is a whole number that a min and max can bound. */
export const isNumericMask = (mask: readonly MaskToken[]): boolean => mask.length > 0 && mask.every((t) => t === "digit");

/** How many different IDs the pattern allows (a literal contributes one). */
export function maskCapacity(mask: readonly MaskToken[]): bigint {
  let n = 1n;
  for (const t of mask) n *= BigInt(alphabetOf(t).length);
  return n;
}

/**
 * How many different IDs an ID column may use: for a whole-number pattern with a min and max, the
 * numbers between them (and no more than the pattern's digits allow); otherwise the whole pattern.
 */
export function idCapacity(mask: readonly MaskToken[], min?: number, max?: number): bigint {
  const patternCapacity = maskCapacity(mask);
  if (isNumericMask(mask) && min !== undefined && max !== undefined && max >= min) {
    const range = BigInt(max) - BigInt(min) + 1n;
    return range < patternCapacity ? range : patternCapacity;
  }
  return patternCapacity;
}

/** The ID at a position in the pattern's own ordering: a mixed-radix reading of `index`. */
export function maskValueAt(mask: readonly MaskToken[], index: bigint): string {
  let rest = index;
  const out = new Array<string>(mask.length);
  for (let i = mask.length - 1; i >= 0; i--) {
    const alphabet = alphabetOf(mask[i]);
    const radix = BigInt(alphabet.length);
    out[i] = alphabet[Number(rest % radix)];
    rest /= radix;
  }
  return out.join("");
}

/** Number-only version of maskValueAt, for patterns small enough that every step stays exact. */
export function maskValueAtNumber(mask: readonly MaskToken[], index: number): string {
  let rest = index;
  const out = new Array<string>(mask.length);
  for (let i = mask.length - 1; i >= 0; i--) {
    const alphabet = alphabetOf(mask[i]);
    out[i] = alphabet[rest % alphabet.length];
    rest = Math.floor(rest / alphabet.length);
  }
  return out.join("");
}

const CLASS_REGEX: Record<string, string> = {
  digit: "[0-9]",
  upper: "[A-Z]",
  lower: "[a-z]",
  letter: "[A-Za-z]",
  alnum: "[A-Za-z0-9]",
};

const escapeLiteral = (c: string) => c.replace(/[.*+?^${}()|[\]\\-]/g, (m) => (m === "-" ? "-" : `\${m}`));

/** A readable form of the pattern, such as UT-[0-9]{3}-[0-9]{3}. */
export function maskToRegexString(mask: readonly MaskToken[]): string {
  let out = "";
  for (let i = 0; i < mask.length; ) {
    const t = mask[i];
    if (isLiteral(t)) {
      out += escapeLiteral(t.literal);
      i++;
      continue;
    }
    let run = 1;
    while (i + run < mask.length && mask[i + run] === t) run++;
    out += CLASS_REGEX[t] + (run > 1 ? `{${run}}` : "");
    i += run;
  }
  return out;
}

/** Whether an ID fits the pattern exactly (same length, each character allowed at its position). */
export function matchesMask(id: string, mask: readonly MaskToken[]): boolean {
  if (id.length !== mask.length) return false;
  for (let i = 0; i < mask.length; i++) if (!alphabetOf(mask[i]).includes(id[i])) return false;
  return true;
}

/** Splits a position's observed characters into the token that describes them. */
export function tokenForPosition(chars: { distinct: number; first: string; allDigits: boolean; allUpper: boolean; allLower: boolean; allLetters: boolean }): MaskToken {
  // A repeated digit is usually part of a number, so only letters and symbols become fixed literals.
  if (chars.distinct === 1 && !chars.allDigits) return { literal: chars.first };
  if (chars.allDigits) return "digit";
  if (chars.allUpper) return "upper";
  if (chars.allLower) return "lower";
  if (chars.allLetters) return "letter";
  return "alnum";
}
