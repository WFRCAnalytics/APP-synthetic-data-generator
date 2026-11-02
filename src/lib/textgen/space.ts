// How many distinct values each personal kind can invent before a suffix is needed. These numbers
// are the sizes of the word-list spaces in `personal.ts`, written out here so the profile worker and
// the page can warn about a suffix without loading the word lists (a unit test keeps them equal to
// the real composers).

import type { PersonalKind } from "../spec/types";

export const NATURAL_SPACE: Record<PersonalKind, number> = {
  full_name: 1_506_978,
  first_name: 3_186,
  last_name: 473,
  email: 12_055_824,
  phone: 800_890_000,
  address: 1_460_403_945,
  url: 5_982_017_994,
  ip: 215 * 256 * 256 * 254,
  ssn: 98_990_100,
};

/** Kinds whose format has no room for a suffix; a column needing more values than the space is refused. */
export const NO_SUFFIX: ReadonlySet<PersonalKind> = new Set<PersonalKind>(["phone", "ip", "ssn"]);

/** True when a column of this kind with this many distinct values needs a suffix on some of them. */
export const needsSuffix = (kind: PersonalKind, distinct: number): boolean =>
  !NO_SUFFIX.has(kind) && distinct > NATURAL_SPACE[kind];
