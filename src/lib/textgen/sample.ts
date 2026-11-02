// Live samples for the Review cards (specs/002 FR-010, research R10): a few invented values for a column
// description, so the user can judge a kind or a pattern before generating. The values are invented
// from the word lists, never taken from the data, so showing them is safe. Runs in the generate worker.

import type { MaskToken, PersonalFormat, PersonalKind } from "../spec/types";
import { maskCapacity } from "../mask/mask";
import { loremText } from "./lorem";
import type { PersonalLocale } from "./locales";
import { makePersonalComposer } from "./personal";
import { makeShortStringGenerator } from "./shortstring";

export type SampleDescription =
  | {
      kind: "personal";
      personalKind: PersonalKind;
      format?: PersonalFormat;
      locale?: PersonalLocale;
    }
  | { kind: "free_text"; min: number; max: number }
  | { kind: "short_string"; pattern: MaskToken[]; lengthGroups: Record<string, number> };

export const MAX_SAMPLES = 10;

/** Up to `count` invented values (at most MAX_SAMPLES) that fit the description. */
export function sampleValues(
  description: SampleDescription,
  count: number,
  seed: number,
): string[] {
  const n = Math.max(0, Math.min(MAX_SAMPLES, Math.floor(count)));
  if (n === 0) return [];

  switch (description.kind) {
    case "personal": {
      const composer = makePersonalComposer(
        description.personalKind,
        description.format,
        description.locale,
      );
      // Spread the positions over the whole space, so the sample shows variety rather than the first entries.
      const step = Math.max(1, Math.floor(composer.natural / n));
      const offset = Math.abs(Math.imul(seed + 1, 2654435761)) % step;
      return Array.from({ length: n }, (_, i) =>
        composer.valueAt(Math.min(composer.natural - 1, i * step + offset), 0),
      );
    }

    case "free_text": {
      const { min, max } = description;
      const lo = Math.max(1, Math.min(min, max));
      const hi = Math.max(lo, max);
      return Array.from({ length: n }, (_, i) =>
        loremText(Math.round(lo + ((hi - lo) * (i % 5)) / 4), seed, i, false),
      );
    }

    case "short_string": {
      const lengths = Object.keys(description.lengthGroups)
        .map(Number)
        .filter((l) => l > 0)
        .sort((a, b) => a - b);
      if (lengths.length === 0 || description.pattern.length === 0) return [];
      // Ask for a few values of each length, never more than the pattern can make.
      const per = Math.ceil(n / lengths.length);
      const groups: Record<string, number> = {};
      for (const l of lengths) {
        const room = maskCapacity(description.pattern.slice(0, l));
        groups[String(l)] = Number(room < BigInt(per) ? room : BigInt(per));
      }
      const generator = makeShortStringGenerator(
        { pattern: description.pattern, length_groups: groups },
        seed,
      );
      return Array.from({ length: Math.min(n, generator.groups) }, (_, g) => generator(g));
    }
  }
}
