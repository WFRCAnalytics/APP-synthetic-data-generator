// @vitest-environment node
// Several tables from their saved specs (specs/028): which links fit together, how the files are named and kept apart.
import { describe, expect, it } from "vitest";
import { batchFileName, batchFiles, batchWarnings, loadBatch, specForOutput, type BatchResult, type BatchTable } from "../../src/app/batch";
import { linkTo } from "../../src/lib/ids/link";
import { SPEC_VERSION, type ColumnSpec, type SpecFile, type SurveyIdColumn } from "../../src/lib/spec/types";

const csv = (file: string): SpecFile["source"] => ({ format: "csv", file_name: file, encoding: "utf-8", delimiter: ",", quote: '"', quote_style: "minimal", line_ending: "lf", trailing_newline: true, header: true });
const idCol = (name: string, repeat: Record<string, number>, link?: SurveyIdColumn["link"]): SurveyIdColumn => ({ name, type: "survey_id", mask: ["upper", "digit", "digit", "digit"], repeat_structure: repeat, ...(link ? { link } : {}) });
const spec = (file: string, seed: number, columns: ColumnSpec[], rows: number): SpecFile => ({ spec_version: SPEC_VERSION, source: csv(file), n_rows: rows, seed, columns });

const households = spec("households.csv", 5, [idCol("hh_id", { "1": 100 })], 100);
const link = linkTo(households, households.columns[0] as SurveyIdColumn);
const persons = spec("persons.csv", 9, [idCol("hh_id", { "2": 40 }, link)], 80);

const table = (id: number, s: SpecFile): BatchTable => ({ id, specName: `${s.source.file_name}.spec.json`, spec: s });

describe("batchWarnings", () => {
  it("says nothing when every link finds its table", () => {
    expect(batchWarnings([table(1, households), table(2, persons)])).toEqual([]);
  });
  it("names a table whose IDs come from a table that is not in the set, or made with another seed", () => {
    const lone = batchWarnings([table(2, persons)]);
    expect(lone).toHaveLength(1);
    expect(lone[0]).toContain("households.csv");
    expect(lone[0]).toContain("seed 5");
    const other = batchWarnings([table(1, { ...households, seed: 6 }), table(2, persons)]);
    expect(other).toHaveLength(1);
  });
  it("names a count whose other table is missing", () => {
    const size: ColumnSpec = { name: "size", type: "integer", mode: "uniform", min: 0, max: 3, mean: 1, sd: 1, decimals: 0, quantiles: Array.from({ length: 101 }, () => 1), child_count: { column: "hh_id", child: { table: "persons.csv", column: "hh_id", seed: 9, repeat_structure: { "2": 40 }, groups: 100 } } };
    const parent = spec("households.csv", 5, [idCol("hh_id", { "1": 100 }), size], 100);
    expect(batchWarnings([table(1, parent)])).toHaveLength(1);
    expect(batchWarnings([table(1, parent), table(2, persons)])).toEqual([]);
  });
});

describe("batchFiles", () => {
  const result: BatchResult = { parts: [new TextEncoder().encode("a\n1\n")], totalBytes: 4, checks: [], passed: 0, failed: 0 };
  it("puts each table in a folder with its fake file, spec and README", () => {
    const files = batchFiles([table(1, households), table(2, persons)], new Map([[1, result], [2, result]]));
    expect(files.map((f) => f.name)).toEqual([
      "households_fake/households_fake.csv",
      "households_fake/households_spec.json",
      "households_fake/households_fake_README.md",
      "persons_fake/persons_fake.csv",
      "persons_fake/persons_spec.json",
      "persons_fake/persons_fake_README.md",
    ]);
  });
  it("keeps two tables with the same file name apart", () => {
    const again = spec("households.csv", 8, [idCol("hh_id", { "1": 100 })], 100);
    const files = batchFiles([table(1, households), table(2, again)], new Map([[1, result], [2, result]]));
    expect(new Set(files.map((f) => f.name.split("/")[0]))).toEqual(new Set(["households_fake", "households_fake_2"]));
  });
  it("leaves out a table that was not made", () => {
    expect(batchFiles([table(1, households), table(2, persons)], new Map([[2, result]])).length).toBe(3);
  });
  it("names the fake file like the single-table flow does", () => {
    expect(batchFileName(households)).toBe("households_fake.csv");
    expect(batchFileName({ ...households, keep_original_name: true })).toBe("households.csv");
  });
});

describe("loadBatch", () => {
  it("keeps valid specs and sets the rest aside without quoting them", async () => {
    const good = new File([JSON.stringify(households)], "households_spec.json");
    const bad = new File(["{ not json SECRET"], "broken.json");
    const { tables, rejected } = await loadBatch([good, bad]);
    expect(tables.map((t) => t.specName)).toEqual(["households_spec.json"]);
    expect(rejected).toEqual([{ specName: "broken.json", reason: "This is not a valid spec." }]);
  });
});

describe("a file type for the whole set", () => {
  const result: BatchResult = { parts: [new TextEncoder().encode("a1")], totalBytes: 4, checks: [], passed: 0, failed: 0 };
  it("names each fake file and spec for the chosen type", () => {
    expect(batchFileName(households, "parquet")).toBe("households_fake.parquet");
    expect(batchFileName(households, "sav")).toBe("households_fake.sav");
    expect(batchFileName(households, "xpt")).toBe("households_fake.xpt");
    expect(specForOutput(households, "same")).toBe(households);
    expect(specForOutput(households, "sav").source.format).toBe("csv");
    expect(specForOutput(households, "json").source.format).toBe("json");
  });
  it("writes the converted bytes and a spec and README for the type", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const files = batchFiles([table(1, households)], new Map([[1, { ...result, converted: bytes }]]), "sav");
    expect(files.map((f) => f.name)).toEqual(["households_fake/households_fake.sav", "households_fake/households_spec.json", "households_fake/households_fake_README.md"]);
    expect(files[0].blob.size).toBe(3);
  });
});
