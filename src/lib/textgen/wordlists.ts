// The word lists invented values are composed from (specs/002 research R1). They come from the en_US
// data of @faker-js/faker, never from the real file. This is the only module that imports faker, and
// only the generate worker loads it, so the profile worker and the page carry no word lists
// (a build test checks this). Lists are built once, in a fixed order, so output is deterministic.

import { en, en_US } from "@faker-js/faker";

const unique = (...lists: (readonly string[] | null | undefined)[]): string[] => [
  ...new Set(lists.flatMap((l) => l ?? [])),
];

/** Given names, from the generic, female and male lists with duplicates removed. */
export const firstNames: readonly string[] = unique(
  en.person?.first_name?.generic,
  en.person?.first_name?.female,
  en.person?.first_name?.male,
);

export const lastNames: readonly string[] = unique(en.person?.last_name?.generic);

export const streetNames: readonly string[] = unique(
  en_US.location?.street_name,
  en.location?.street_name,
);
export const streetSuffixes: readonly string[] = unique(en.location?.street_suffix);

const phone = en_US.phone_number as { area_code?: string[]; exchange_code?: string[] } | undefined;

/** Area and exchange codes from the en_US phone data. 555 is left out of exchanges: it is the reserved fictional exchange. */
export const areaCodes: readonly string[] = unique(phone?.area_code).filter((a) =>
  /^[2-9]\d\d$/.test(a),
);
export const exchangeCodes: readonly string[] = unique(phone?.exchange_code).filter(
  (e) => /^[2-9]\d\d$/.test(e) && e !== "555",
);

/** Mail domains: faker's free providers plus a few more, never example.* and never a domain from real data. */
export const emailDomains: readonly string[] = unique(en.internet?.free_email, [
  "outlook.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "fastmail.com",
]);
export const topLevelDomains: readonly string[] = unique(en.internet?.domain_suffix, ["com"]);

/** Latin filler words, used for URL parts and free text. */
export const loremWords: readonly string[] = unique(en.lorem?.word);

// ---- Other regions (specs/014) ----------------------------------------------------------------------------------

import { de, es, es_MX, fr, pt_BR } from "@faker-js/faker";
import type { PersonalLocale } from "./locales";

/** Everything a region needs to invent a name, an email, a phone number or a street address. */
export interface LocaleWords {
  firstNames: readonly string[];
  lastNames: readonly string[];
  /** Whole street names (the pattern of the region applied once, in a fixed order). */
  streets: readonly string[];
  /** Where the house number goes: before the street (12 Rue de Paris), after it (Calle Mayor 12) or after a comma. */
  numberPlacement: "before" | "after" | "comma";
  /** The shape of a phone number (9 stands for a digit). */
  phoneShape: string;
}

const REGIONS = { es, es_MX, fr, de, pt_BR } as const;
type Region = keyof typeof REGIONS;

/** Street names in the pattern each region writes them (only the lists faker holds, combined in a fixed order). */
function streetsOf(region: Region, firsts: readonly string[], lasts: readonly string[]): string[] {
  const loc = REGIONS[region].location as
    { street_name?: string[]; street_prefix?: string[]; street_suffix?: string[] } | undefined;
  const prefix = loc?.street_prefix ?? [];
  const suffix = loc?.street_suffix ?? [];
  switch (region) {
    case "de":
      return unique(loc?.street_name);
    case "fr":
      return prefix.flatMap((p) => suffix.map((s) => `${p} ${s}`));
    case "es":
      return suffix.flatMap((s) => firsts.slice(0, 60).map((f) => `${s} ${f}`));
    case "es_MX":
      return prefix.flatMap((p) => firsts.slice(0, 120).map((f) => `${p} ${f}`));
    case "pt_BR":
      return prefix.flatMap((p) => [...firsts.slice(0, 40), ...lasts].map((n) => `${p} ${n}`));
  }
}

const PLACEMENT: Record<Region, LocaleWords["numberPlacement"]> = {
  es: "comma",
  es_MX: "after",
  fr: "before",
  de: "after",
  pt_BR: "comma",
};
const PHONE_SHAPE: Record<Region, string> = {
  es: "999 99 99 99",
  es_MX: "999 999 9999",
  fr: "99 99 99 99 99",
  de: "9999 9999999",
  pt_BR: "(99) 99999-9999",
};

const cache = new Map<PersonalLocale, LocaleWords>();

/** The words of a region other than en_US, built once. */
export function localeWords(locale: Exclude<PersonalLocale, "en_US">): LocaleWords {
  const hit = cache.get(locale);
  if (hit) return hit;
  const data = REGIONS[locale];
  const firstNames = unique(
    data.person?.first_name?.generic,
    data.person?.first_name?.female,
    data.person?.first_name?.male,
  );
  const lastNames = unique(data.person?.last_name?.generic);
  const words: LocaleWords = {
    firstNames,
    lastNames,
    streets: streetsOf(locale, firstNames, lastNames),
    numberPlacement: PLACEMENT[locale],
    phoneShape: PHONE_SHAPE[locale],
  };
  cache.set(locale, words);
  return words;
}
