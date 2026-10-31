// Faker word lists are only in the generate worker (specs/002 FR-015, research R11, R12): the profile
// worker and the main page must not carry them, so profiling never touches invented-value data. Runs
// against the production build, so it is skipped when `dist` has not been built (`npm run build`);
// the deploy workflow builds first and runs it.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { en } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

const ASSETS = join(__dirname, "../../dist/assets");
const built = existsSync(ASSETS);

const read = (prefix: string): string => {
  const file = readdirSync(ASSETS).find((f) => f.startsWith(prefix) && f.endsWith(".js"));
  if (!file) throw new Error(`no ${prefix} bundle in dist/assets`);
  return readFileSync(join(ASSETS, file), "utf8");
};

// Long words from three of the lists (not street suffixes: words like "Extension" occur in other code), so a match cannot be a coincidence.
const longest = (list: readonly string[] | undefined, n: number) => [...(list ?? [])].filter((w) => /^[A-Za-z]{9,}$/.test(w)).sort().slice(0, n);
const MARKERS = [...longest(en.person?.last_name?.generic, 6), ...longest(en.person?.first_name?.female, 6), ...longest(en.lorem?.word, 6)];

describe.skipIf(!built)("the word lists are in the generate worker only", () => {
  it("has markers to look for", () => {
    expect(MARKERS.length).toBeGreaterThan(10);
  });

  it("the generate worker carries them", () => {
    const bundle = read("generate.worker");
    const found = MARKERS.filter((m) => bundle.includes(m));
    expect(found.length).toBeGreaterThan(MARKERS.length * 0.8);
  });

  it("the profile worker carries none", () => {
    const bundle = read("profile.worker");
    expect(MARKERS.filter((m) => bundle.includes(m))).toEqual([]);
  });

  it("the main page bundle carries none", () => {
    const bundle = read("index-");
    expect(MARKERS.filter((m) => bundle.includes(m))).toEqual([]);
  });

  it("the generate worker grew by less than the 1.5 MB budget", () => {
    const file = readdirSync(ASSETS).find((f) => f.startsWith("generate.worker"))!;
    const BASELINE = 36_386; // bytes before this feature (research.md, bundle size baseline)
    expect(statSync(join(ASSETS, file)).size - BASELINE).toBeLessThan(1_500_000);
  });
});
