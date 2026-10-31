// Composers for the personal identifier kinds (specs/002 research R3, R4). A composer turns a position
// in a space of possible values into a value, and a suffix into a way of telling apart the values of a
// column that needs more distinct values than the space holds. Composers hold no state: the same
// (index, suffix) always gives the same value, and two different pairs never give the same value.

import type { PersonalFormat, PersonalKind } from "../spec/types";
import { mixedRadix } from "./compose";
import { makePhoneComposer } from "./phone";
import { makeSsnComposer } from "./ssn";
import * as words from "./wordlists";

export interface Composer {
  /** How many different values exist before a suffix is needed. */
  natural: number;
  /**
   * False for kinds whose format has no room for a suffix (phone numbers, IP addresses, SSN-style
   * numbers). Their space is hundreds of millions of values, so a column needing more is refused.
   */
  suffixes: boolean;
  valueAt(index: number, suffix: number): string;
}

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** "", "2", "3": the number that tells apart values of a column that outgrew the space. */
const numberSuffix = (suffix: number): string => (suffix === 0 ? "" : String(suffix + 1));

/**
 * Names first use the pairs of given and family names, then a middle initial (A to Z), then a number.
 * Suffix 1 to 26 is an initial; 27 and up is an initial and a number.
 */
function nameParts(suffix: number): { initial: string; number: string } {
  if (suffix === 0) return { initial: "", number: "" };
  if (suffix <= 26) return { initial: ALPHA[suffix - 1], number: "" };
  const cycle = suffix - 1;
  return { initial: ALPHA[cycle % 26], number: String(Math.floor(cycle / 26) + 1) };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function fullName(format?: PersonalFormat): Composer {
  const f = words.firstNames;
  const l = words.lastNames;
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

function email(): Composer {
  const f = words.firstNames;
  const l = words.lastNames;
  const d = words.emailDomains;
  return {
    natural: f.length * l.length * d.length,
    suffixes: true,
    valueAt(index, suffix) {
      const [fi, li, di] = mixedRadix(index, [f.length, l.length, d.length]);
      return `${slug(f[fi])}.${slug(l[li])}${numberSuffix(suffix)}@${d[di]}`;
    },
  };
}

function address(format?: PersonalFormat): Composer {
  const streets = words.streetNames;
  const suffixes = words.streetSuffixes;
  const NUMBERS = 9999;
  return {
    natural: NUMBERS * streets.length * suffixes.length,
    suffixes: true,
    valueAt(index, suffix) {
      const [n, si, xi] = mixedRadix(index, [NUMBERS, streets.length, suffixes.length]);
      const street = `${n + 1} ${streets[si]} ${suffixes[xi]}`;
      const unit = format?.unit ? `, ${(index * 2654435761) % 2 === 0 ? "Apt." : "Suite"} ${(index % 899) + 100}` : "";
      return `${street}${unit}${suffix === 0 ? "" : ` #${suffix + 1}`}`;
    },
  };
}

function url(): Composer {
  const w = words.loremWords;
  const t = words.topLevelDomains;
  return {
    natural: w.length * w.length * t.length * w.length,
    suffixes: true,
    valueAt(index, suffix) {
      const [a, b, tld, path] = mixedRadix(index, [w.length, w.length, t.length, w.length]);
      return `https://www.${w[a]}${w[b]}${numberSuffix(suffix)}.${t[tld]}/${w[path]}`;
    },
  };
}

// First octets that are not private, loopback, link-local, multicast, documentation or reserved, so an
// invented address is never a real internal address and never one of the documentation ranges.
const RESERVED_FIRST_OCTETS = new Set([0, 10, 100, 127, 169, 172, 192, 198, 203]);
const FIRST_OCTETS = Array.from({ length: 223 }, (_, i) => i + 1).filter((o) => !RESERVED_FIRST_OCTETS.has(o));

function ip(): Composer {
  return {
    natural: FIRST_OCTETS.length * 256 * 256 * 254,
    suffixes: false,
    valueAt(index) {
      const [a, b, c, d] = mixedRadix(index, [FIRST_OCTETS.length, 256, 256, 254]);
      return `${FIRST_OCTETS[a]}.${b}.${c}.${d + 1}`;
    },
  };
}

function firstName(): Composer {
  const f = words.firstNames;
  return { natural: f.length, suffixes: true, valueAt: (index, suffix) => `${f[index]}${suffix === 0 ? "" : ` ${suffix + 1}`}` };
}

function lastName(): Composer {
  const l = words.lastNames;
  return { natural: l.length, suffixes: true, valueAt: (index, suffix) => `${l[index]}${suffix === 0 ? "" : ` ${suffix + 1}`}` };
}

/** The composer for a kind, honoring the format classes profiled from the real column. */
export function makePersonalComposer(kind: PersonalKind, format?: PersonalFormat): Composer {
  switch (kind) {
    case "full_name":
      return fullName(format);
    case "first_name":
      return firstName();
    case "last_name":
      return lastName();
    case "email":
      return email();
    case "phone":
      return makePhoneComposer(format);
    case "address":
      return address(format);
    case "url":
      return url();
    case "ip":
      return ip();
    case "ssn":
      return makeSsnComposer(format);
  }
}
