// The word lists invented values are composed from (specs/002 research R1). They come from the en_US
// data of @faker-js/faker, never from the real file. This is the only module that imports faker, and
// only the generate worker loads it, so the profile worker and the page carry no word lists
// (a build test checks this). Lists are built once, in a fixed order, so output is deterministic.

import { en, en_US } from "@faker-js/faker";

const unique = (...lists: (readonly string[] | null | undefined)[]): string[] => [...new Set(lists.flatMap((l) => l ?? []))];

/** Given names, from the generic, female and male lists with duplicates removed. */
export const firstNames: readonly string[] = unique(en.person?.first_name?.generic, en.person?.first_name?.female, en.person?.first_name?.male);

export const lastNames: readonly string[] = unique(en.person?.last_name?.generic);

export const streetNames: readonly string[] = unique(en_US.location?.street_name, en.location?.street_name);
export const streetSuffixes: readonly string[] = unique(en.location?.street_suffix);

const phone = en_US.phone_number as { area_code?: string[]; exchange_code?: string[] } | undefined;

/** Area and exchange codes from the en_US phone data. 555 is left out of exchanges: it is the reserved fictional exchange. */
export const areaCodes: readonly string[] = unique(phone?.area_code).filter((a) => /^[2-9]\d\d$/.test(a));
export const exchangeCodes: readonly string[] = unique(phone?.exchange_code).filter((e) => /^[2-9]\d\d$/.test(e) && e !== "555");

/** Mail domains: faker's free providers plus a few more, never example.* and never a domain from real data. */
export const emailDomains: readonly string[] = unique(en.internet?.free_email, ["outlook.com", "icloud.com", "aol.com", "proton.me", "fastmail.com"]);
export const topLevelDomains: readonly string[] = unique(en.internet?.domain_suffix, ["com"]);

/** Latin filler words, used for URL parts and free text. */
export const loremWords: readonly string[] = unique(en.lorem?.word);
