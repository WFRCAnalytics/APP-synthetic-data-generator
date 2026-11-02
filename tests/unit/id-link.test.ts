// Linked ID columns (specs/019): a column of one table uses the IDs another table's column makes, so a join finds every row,
// each ID of the child exists in the parent, the child's own repeat structure is kept, and the spec holds no ID value.
import { describe, expect, it } from "vitest";
import { linkProblem, linkTo, linkableColumns } from "../../src/lib/ids/link";
import { planTable, rowValues } from "../../src/lib/generate/table";
import { SPEC_VERSION, type ColumnSpec, type SpecFile, type SurveyIdColumn } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";

const source = (name: string): SpecFile["source"] => ({ format: "csv", file_name: name, encoding: "utf-8", delimiter: ",", quote: '"', quote_style: "minimal", line_ending: "lf", trailing_newline: true, header: true });

const idColumn = (name: string, repeat: Record<string, number>, extra: Partial<SurveyIdColumn> = {}): SurveyIdColumn => ({
  name,
  type: "survey_id",
  mask: ["upper", "digit", "digit", "digit", "digit"],
  repeat_structure: repeat,
  ...extra,
});

const rowsOf = (repeat: Record<string, number>) => Object.entries(repeat).reduce((a, [size, n]) => a + Number(size) * n, 0);

const specOf = (file: string, seed: number, columns: ColumnSpec[], rows: number): SpecFile => ({ spec_version: SPEC_VERSION, source: source(file), n_rows: rows, seed, columns });

const households = specOf("households.csv", 11, [idColumn("hh_id", { "1": 200 })], 200);
const link = linkTo(households, households.columns[0] as SurveyIdColumn);
const personsRepeat = { "1": 20, "2": 50, "3": 30 };
const persons = (l = link) => specOf("persons.csv", 99, [idColumn("hh_id", personsRepeat, { link: l })], rowsOf(personsRepeat));

const column = (spec: SpecFile, seed: number) => {
  const plan = planTable(spec, seed);
  return Array.from({ length: spec.n_rows }, (_, r) => rowValues(plan, r)[0]);
};

describe("linked IDs", () => {
  const parentIds = new Set(column(households, 11));
  const childIds = column(persons(), 99);

  it("uses only IDs the other table has", () => {
    expect(parentIds.size).toBe(200);
    expect(childIds.every((id) => parentIds.has(id))).toBe(true);
  });

  it("keeps the child's own repeat structure", () => {
    const counts = new Map<string, number>();
    for (const id of childIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    const sizes: Record<string, number> = {};
    for (const n of counts.values()) sizes[n] = (sizes[n] ?? 0) + 1;
    expect(sizes).toEqual(personsRepeat);
  });

  it("is the same on every run, whatever the seed of the child", () => {
    expect(column(persons(), 99)).toEqual(childIds);
    // The child's own seed changes which parent IDs it picks, never whether they exist.
    expect(column(persons(), 5).every((id) => parentIds.has(id))).toBe(true);
  });

  it("does not match when the parent is made with another seed", () => {
    const other = new Set(column(households, 12));
    expect(childIds.some((id) => !other.has(id))).toBe(true);
  });
});

describe("the link in a spec", () => {
  it("is valid and holds no ID value", () => {
    const spec = persons();
    expect(validateSpec(JSON.parse(JSON.stringify(spec))).ok).toBe(true);
    const text = JSON.stringify(spec);
    for (const id of new Set(column(households, 11))) expect(text).not.toContain(id);
  });

  it("is refused when the child needs more IDs than the parent makes", () => {
    const small = linkTo(specOf("h.csv", 1, [idColumn("hh_id", { "1": 10 })], 10), idColumn("hh_id", { "1": 10 }));
    expect(linkProblem(100, small)).toMatch(/only 10/);
    const result = validateSpec(JSON.parse(JSON.stringify(persons(small))));
    expect(result.ok).toBe(false);
  });

  it("offers the written ID columns of a spec and not linked ones", () => {
    const both = specOf("x.csv", 1, [idColumn("a", { "1": 5 }), idColumn("b", { "1": 5 }, { link }), idColumn("c", { "1": 5 }, { exclude: "drop" })], 5);
    expect(linkableColumns(both).map((c) => c.name)).toEqual(["a"]);
  });
});

describe("the profile and the README", () => {
  it("round-trips through a profile and appears in the README", async () => {
    const { profilesFromSpec } = await import("../../src/lib/spec/toProfiles");
    const { buildSpec } = await import("../../src/lib/spec/build");
    const { agentReadme } = await import("../../src/lib/readme/agentReadme");
    const spec = persons();
    const profiles = profilesFromSpec(spec.columns);
    expect(profiles[0].idLink?.column).toBe("hh_id");
    const rebuilt = buildSpec({ fileName: "persons.csv", settings: { encoding: "utf-8", bom: false, delimiter: ",", quote: '"', quoteStyle: "minimal", lineEnding: "lf", header: true, headerQuoted: false, trailingNewline: true }, rowCount: spec.n_rows, seed: 99, keepOriginalName: false, threshold: 1, profiles });
    expect((rebuilt.columns[0] as SurveyIdColumn).link).toEqual(link);
    const text = agentReadme(rebuilt, { fakeFileName: "persons_fake.csv", seed: 99, appVersion: "0.4.0" });
    expect(text).toContain("the IDs of column `hh_id`");
  });
});

describe("counts that follow the other table", () => {
  const sizeColumn = (): ColumnSpec => ({
    name: "size",
    type: "integer",
    mode: "uniform",
    min: 0,
    max: 3,
    mean: 1.5,
    sd: 1,
    decimals: 0,
    quantiles: Array.from({ length: 101 }, (_, i) => (3 * i) / 100),
    child_count: { column: "hh_id", child: { table: "persons.csv", column: "hh_id", seed: 99, repeat_structure: personsRepeat, groups: 200 } },
  });
  const withSize = specOf("households.csv", 11, [idColumn("hh_id", { "1": 200 }), sizeColumn()], 200);

  const tables = () => {
    const parent = planTable(withSize, 11);
    const child = planTable(persons(), 99);
    const countOf = new Map<string, number>();
    for (let r = 0; r < persons().n_rows; r++) {
      const id = rowValues(child, r)[0];
      countOf.set(id, (countOf.get(id) ?? 0) + 1);
    }
    return { parent, countOf };
  };

  it("makes each ID's number the number of rows the other table has for it", () => {
    const { parent, countOf } = tables();
    let total = 0;
    for (let r = 0; r < withSize.n_rows; r++) {
      const [id, size] = rowValues(parent, r);
      expect(Number(size)).toBe(countOf.get(id) ?? 0);
      total += Number(size);
    }
    expect(total).toBe(persons().n_rows);
  });

  it("is a valid spec, and refused when it does not fit", () => {
    expect(validateSpec(JSON.parse(JSON.stringify(withSize))).ok).toBe(true);
    const wrong = JSON.parse(JSON.stringify(withSize));
    wrong.columns[1].child_count.child.groups = 150;
    expect(validateSpec(wrong).ok).toBe(false);
    const noId = JSON.parse(JSON.stringify(withSize));
    noId.columns[1].child_count.column = "missing";
    expect(validateSpec(noId).ok).toBe(false);
    const withNa = JSON.parse(JSON.stringify(withSize));
    withNa.columns[1].na = { tokens: [""], count: 1 };
    expect(validateSpec(withNa).ok).toBe(false);
  });
});
