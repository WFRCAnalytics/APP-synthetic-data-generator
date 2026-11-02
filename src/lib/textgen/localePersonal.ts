// Composers for the personal kinds in a region other than en_US (specs/014): names, emails, phone numbers and street
// addresses made from the region's own word lists. Like the en_US composers they hold no state: the same (index, suffix)
// always gives the same value and two different pairs never give the same value. Nothing here reads real data.

import type { PersonalFormat, PersonalKind } from "../spec/types";
import { mixedRadix } from "./compose";
import type { Composer } from "./personal";
import { emailDomains, localeWords, type LocaleWords } from "./wordlists";
import type { PersonalLocale } from "./locales";

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const numberSuffix = (suffix: number): string => (suffix === 0 ? "" : String(suffix + 1));

/** An initial (1 to 26), then an initial and a number: the way a column that outgrew its names is told apart. */
function nameParts(suffix: number): { initial: string; number: string } {
  if (suffix === 0) return { initial: "", number: "" };
  if (suffix <= 26) return { initial: ALPHA[suffix - 1], number: "" };
  const cycle = suffix - 1;
  return { initial: ALPHA[cycle % 26], number: String(Math.floor(cycle / 26) + 1) };
}

/** Lower case, accents taken off, nothing but letters and digits: the form a name takes in an email address. */
export const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

function fullName(w: LocaleWords, format?: PersonalFormat): Composer {
  const f = w.firstNames;
  const l = w.lastNames;
  return {
    natural: f.length * l.length,
    suffixes: true,
    valueAt(index, suffix) {
      const [fi, li] = mixedRadix(index, [f.length, l.length]);
      const { initial, number } = nameParts(suffix);
      const given = initial ? `${f[fi]} ${initial}.` : f[fi];
      const family = number ? `${l[li]} ${number}` : l[li];
      return format?.last_first ? `${family}, ${given}` : `${given} ${family}`;
    },
  };
}

function email(w: LocaleWords): Composer {
  const f = w.firstNames;
  const l = w.lastNames;
  const d = emailDomains;
  return {
    natural: f.length * l.length * d.length,
    suffixes: true,
    valueAt(index, suffix) {
      const [fi, li, di] = mixedRadix(index, [f.length, l.length, d.length]);
      return `${fold(f[fi])}.${fold(l[li])}${numberSuffix(suffix)}@${d[di]}`;
    },
  };
}

function address(w: LocaleWords, format?: PersonalFormat): Composer {
  const streets = w.streets;
  const NUMBERS = 999;
  return {
    natural: NUMBERS * streets.length,
    suffixes: true,
    valueAt(index, suffix) {
      const [n, si] = mixedRadix(index, [NUMBERS, streets.length]);
      const street = streets[si];
      const house = n + 1;
      const base =
        w.numberPlacement === "before"
          ? `${house} ${street}`
          : w.numberPlacement === "comma"
            ? `${street}, ${house}`
            : `${street} ${house}`;
      const unit = format?.unit ? `, ${(index % 9) + 1}º` : "";
      return `${base}${unit}${suffix === 0 ? "" : ` #${suffix + 1}`}`;
    },
  };
}

/** Puts digits into the 9s of a shape, from the right: padded with zeros when the shape has more places, cut when it has fewer. */
function fillDigits(shape: string, digits: string): string {
  const slots = (shape.match(/9/g) ?? []).length;
  const use = digits.length >= slots ? digits.slice(digits.length - slots) : digits.padStart(slots, "0");
  let i = 0;
  return shape.replace(/9/g, () => use[i++]);
}

/** A phone number in the region's shape: its digits are a scrambled count, never a number from real data. */
function phone(w: LocaleWords, format?: PersonalFormat): Composer {
  const shapes =
    format?.shapes && format.shapes.length > 0
      ? format.shapes
      : [{ shape: w.phoneShape, share: 1 }];
  const total = shapes.reduce((a, s) => a + s.share, 0) || 1;
  const cumulative: number[] = [];
  shapes.reduce((acc, s) => (cumulative.push(acc + s.share / total), acc + s.share / total), 0);
  // The digits of the commonest shape set how many numbers exist; the others are filled from the same digits.
  const slots = Math.min(9, (w.phoneShape.match(/9/g) ?? []).length);
  const space = 10 ** slots;
  return {
    natural: space,
    suffixes: false,
    valueAt(index) {
      const scrambled = (index * 48271 + 7) % space; // 48271 has no factor of 2 or 5, so this never repeats within the space
      const digits = String(scrambled).padStart(slots, "0");
      const u = ((Math.imul(index, 2654435761) >>> 0) % 1_000_003) / 1_000_003;
      const k = cumulative.findIndex((c) => u < c);
      return fillDigits(shapes[k < 0 ? shapes.length - 1 : k].shape, digits);
    },
  };
}

function firstName(w: LocaleWords): Composer {
  const f = w.firstNames;
  return {
    natural: f.length,
    suffixes: true,
    valueAt: (index, suffix) => `${f[index]}${suffix === 0 ? "" : ` ${suffix + 1}`}`,
  };
}

function lastName(w: LocaleWords): Composer {
  const l = w.lastNames;
  return {
    natural: l.length,
    suffixes: true,
    valueAt: (index, suffix) => `${l[index]}${suffix === 0 ? "" : ` ${suffix + 1}`}`,
  };
}

/** The composer for a kind in a region, or null for a kind the region does not change (web and IP addresses, SSN-style numbers). */
export function makeLocalePersonalComposer(
  kind: PersonalKind,
  format: PersonalFormat | undefined,
  locale: Exclude<PersonalLocale, "en_US">,
): Composer | null {
  const w = localeWords(locale);
  switch (kind) {
    case "full_name":
      return fullName(w, format);
    case "first_name":
      return firstName(w);
    case "last_name":
      return lastName(w);
    case "email":
      return email(w);
    case "phone":
      return phone(w, format);
    case "address":
      return address(w, format);
    default:
      return null;
  }
}
