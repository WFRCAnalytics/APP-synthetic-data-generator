// A column that takes the other table's value (specs/030): in every row of the persons table, the zone is the zone of the
// household row with the same ID, whatever the seed of the persons table, and the spec holds no ID and no row.
import { describe, expect, it } from "vitest";
import { linkTo, parentColumnsOf, parentValueFrom } from "../../src/lib/ids/link";
import { planTable, rowValues } from "../../src/lib/generate/table";
import { SPEC_VERSION, type CategoricalColumn, type ColumnSpec, type SpecFile, type SurveyIdColumn } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";

const source = (name: string): SpecFile["source"] => ({ format: "csv", file_name: name, encoding: "utf-8", delimiter: ",", quote: '"', quote_style: "minimal", line_ending: "lf", trailing_newline: true, header: true });
const id = (name: string, repeat: Record<string, number>, extra: Partial<SurveyIdColumn> = {}): SurveyIdColumn => ({ name, type: "survey_id", mask: ["upper", "digit", "digit", "digit", "digit"], repeat_structure: repeat, ...extra });
const specOf = (file: string, seed: number, columns: ColumnSpec[], rows: number): SpecFile => ({ spec_version: SPEC_VERSION, source: source(file), n_rows: rows, seed, columns });

const zone: CategoricalColumn = { name: "zone", type: "categorical", counts: { north: 90, south: 70, east: 30 }, na: { tokens: [""], count: 10 } };
const households = specOf("households.csv", 11, [id("hh_id", { "1": 200 }), zone], 200);
const link = linkTo(households, households.columns[0] as SurveyIdColumn);
const repeat = { "1": 20, "2": 50, "3": 30 };
const follower = (): CategoricalColumn => ({ name: "zone", type: "categorical", counts: { north: 100, south: 110 }, from_parent: parentValueFrom(households, zone, "hh_id", link) });
const persons = (): SpecFile => specOf("persons.csv", 99, [id("hh_id", repeat, { link }), follower()], 210);

const table = (spec: SpecFile, seed: number) => {
  const plan = planTable(spec, seed);
  return Array.from({ length: spec.n_rows }, (_, r) => rowValues(plan, r));
};

describe("a column that takes the other table's value", () => {
  const parent = new Map(table(households, 11).map(([hh, z]) => [hh, z]));

  it("holds, in every row, the value of the row with the same ID", () => {
    const rows = table(persons(), 99);
    expect(rows.length).toBe(210);
    for (const [hh, z] of rows) expect(z).toBe(parent.get(hh));
    expect(new Set(rows.map((r) => r[1])).size).toBeGreaterThan(1);
  });

  it("holds whatever the seed of this table", () => {
    for (const seed of [1, 5, 99]) for (const [hh, z] of table(persons(), seed)) expect(z).toBe(parent.get(hh));
  });

  it("does not hold when the other table is made with another seed", () => {
    const other = new Map(table(households, 12).map(([hh, z]) => [hh, z]));
    expect(table(persons(), 99).some(([hh, z]) => other.get(hh) !== z)).toBe(true);
  });

  it("is a valid spec that holds no ID", () => {
    const spec = persons();
    const r = validateSpec(JSON.parse(JSON.stringify(spec)));
    expect(r.ok ? [] : r.problems).toEqual([]);
    const text = JSON.stringify(spec);
    for (const hh of parent.keys()) expect(text).not.toContain(hh);
  });

  it("is refused when the ID column does not match the other table, or has missing values of its own", () => {
    const wrongSeed = persons();
    (wrongSeed.columns[1] as CategoricalColumn).from_parent!.parent.seed = 12;
    expect(validateSpec(JSON.parse(JSON.stringify(wrongSeed))).ok).toBe(false);
    const missing = persons();
    (missing.columns[1] as CategoricalColumn).na = { tokens: [""], count: 1 };
    expect(validateSpec(JSON.parse(JSON.stringify(missing))).ok).toBe(false);
  });

  it("offers the plain categories of a table whose IDs are one per row, not those a rule changes", () => {
    expect(parentColumnsOf(households, link).map((c) => c.name)).toEqual(["zone"]);
    expect(parentColumnsOf({ ...households, seed: 12 }, link)).toEqual([]);
    expect(parentColumnsOf({ ...households, rules: [{ kind: "blank_with", column: "zone", source: "hh_id" } as never] }, link)).toEqual([]);
  });
});
