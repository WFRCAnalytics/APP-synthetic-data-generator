// Four linked tables, built only from the generic features (linked IDs, counts that follow the parent, values that follow the
// parent, a chain through two links): households, persons, vehicles and trips, the shape a household travel survey has.
// Nothing here is specific to one survey; every join must match in every row.
import { describe, expect, it } from "vitest";
import { batchWarnings, type BatchTable } from "../../src/app/batch";
import { childCountFrom, linkTo, parentValueFrom } from "../../src/lib/ids/link";
import { planTable, rowValues } from "../../src/lib/generate/table";
import { SPEC_VERSION, type ColumnSpec, type SpecFile, type SurveyIdColumn } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";

const src = (name: string): SpecFile["source"] => ({ format: "csv", file_name: name, encoding: "utf-8", delimiter: ",", quote: '"', quote_style: "minimal", line_ending: "lf", trailing_newline: true, header: true });
const id = (name: string, repeat: Record<string, number>, extra: Partial<SurveyIdColumn> = {}): SurveyIdColumn => ({ name, type: "survey_id", mask: ["upper", "digit", "digit", "digit", "digit"], repeat_structure: repeat, ...extra });
const spec = (file: string, seed: number, columns: ColumnSpec[], rows: number): SpecFile => ({ spec_version: SPEC_VERSION, source: src(file), n_rows: rows, seed, columns });
const q = (lo: number, hi: number) => Array.from({ length: 101 }, (_, i) => Math.round(lo + ((hi - lo) * i) / 100));
const number = (name: string, min: number, max: number): ColumnSpec => ({ name, type: "integer", mode: "uniform", min, max, mean: (min + max) / 2, sd: (max - min) / 4, decimals: 0, quantiles: q(min, max) });
const category = (name: string, counts: Record<string, number>): ColumnSpec => ({ name, type: "categorical", counts });

const H = 100;
const county = category("county", { A: 40, B: 35, C: 25 });
const income = number("income", 10_000, 150_000);
const householdsBase = spec("households.csv", 1, [id("hh_id", { "1": H }), county, income], H);
const hhLink = linkTo(householdsBase, householdsBase.columns[0] as SurveyIdColumn);

const P = 250; // persons: 1 to 4 per household, every household has some
const personRepeat = { "1": 10, "2": 40, "3": 40, "4": 10 };
const personsOf = (extra: ColumnSpec[] = []) => spec("persons.csv", 2, [id("person_id", { "1": P }), id("hh_id", personRepeat, { link: hhLink }), { ...category("county", { A: 100, B: 90, C: 60 }), from_parent: parentValueFrom(householdsBase, county, "hh_id", hhLink) } as ColumnSpec, ...extra], P);
const persons = personsOf();
const personLink = linkTo(persons, persons.columns[0] as SurveyIdColumn);

const V = 120; // vehicles: 0 to 2 per household here, 120 in all
const vehicles = spec("vehicles.csv", 3, [id("veh_id", { "1": V }), id("hh_id", { "1": 60, "2": 30 }, { link: hhLink }), { ...income, from_parent: parentValueFrom(householdsBase, income, "hh_id", hhLink) } as ColumnSpec], V);

const T = 500; // trips: 100 persons made 3 trips and 50 made 4
const trips = spec("trips.csv", 4, [id("trip_id", { "1": T }), id("person_id", { "3": 100, "4": 50 }, { link: personLink }), { ...category("county", { A: 200, B: 200, C: 100 }), from_parent: parentValueFrom(persons, persons.columns[2], "person_id", personLink) } as ColumnSpec], T);

// The households count their persons and their vehicles.
const countsPersons = childCountFrom(persons, persons.columns[1] as SurveyIdColumn)!;
const households = { ...householdsBase, columns: [...householdsBase.columns, { ...number("size", 0, 4), child_count: countsPersons } as ColumnSpec] };

const rows = (s: SpecFile, seed = s.seed) => {
  const plan = planTable(s, seed);
  return Array.from({ length: s.n_rows }, (_, r) => rowValues(plan, r));
};

describe("four linked tables", () => {
  const hh = rows(households);
  const pp = rows(persons);
  const vv = rows(vehicles);
  const tt = rows(trips);

  it("are all valid specs", () => {
    for (const s of [households, persons, vehicles, trips]) {
      const r = validateSpec(JSON.parse(JSON.stringify(s)));
      expect(r.ok ? [] : r.problems).toEqual([]);
    }
  });

  it("join on every ID", () => {
    const hhIds = new Set(hh.map((r) => r[0]));
    const personIds = new Set(pp.map((r) => r[0]));
    expect(pp.every((r) => hhIds.has(r[1]))).toBe(true);
    expect(vv.every((r) => hhIds.has(r[1]))).toBe(true);
    expect(tt.every((r) => personIds.has(r[1]))).toBe(true);
  });

  it("give a household the number of persons it has", () => {
    const counts = new Map<string, number>();
    for (const r of pp) counts.set(r[1], (counts.get(r[1]) ?? 0) + 1);
    for (const r of hh) expect(Number(r[3])).toBe(counts.get(r[0]) ?? 0);
  });

  it("give persons the county of their household, and vehicles its income", () => {
    const county = new Map(hh.map((r) => [r[0], r[1]]));
    const income = new Map(hh.map((r) => [r[0], r[2]]));
    for (const r of pp) expect(r[2]).toBe(county.get(r[1]));
    for (const r of vv) expect(r[2]).toBe(income.get(r[1]));
  });

  it("give a trip the county of its person's household", () => {
    const county = new Map(hh.map((r) => [r[0], r[1]]));
    const household = new Map(pp.map((r) => [r[0], r[1]]));
    for (const r of tt) expect(r[2]).toBe(county.get(household.get(r[1]) as string));
  });

  it("are made again, the same, whatever order the tables are made in", () => {
    expect(rows(trips)).toEqual(tt);
    expect(rows(households)).toEqual(hh);
  });

  it("raise no warning when the set is whole, and name what is missing when a table is left out", () => {
    const set = (...s: SpecFile[]): BatchTable[] => s.map((x, i) => ({ id: i + 1, specName: `${x.source.file_name}.spec.json`, spec: x }));
    expect(batchWarnings(set(households, persons, vehicles, trips))).toEqual([]);
    expect(batchWarnings(set(households, trips)).length).toBeGreaterThan(0);
  });
});
