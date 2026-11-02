// @vitest-environment node
// The value labels of SPSS and Stata files (specs/021), read from the files' own label records and checked against what the
// independent reader (pyreadstat) says the files hold.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDtaLabels, parseSavLabels } from "../../src/lib/stat/labels";

const dir = join(process.cwd(), "tests/fixtures/stat");
const bytes = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
const python = spawnSync("python", ["-c", "import pyreadstat"]).status === 0;

const expected = [
  { column: "mode", value: "1", label: "Car" },
  { column: "mode", value: "2", label: "Bus" },
  { column: "mode", value: "3", label: "Walk" },
  { column: "mode", value: "4", label: "Bike" },
];

describe("SPSS labels", () => {
  it("reads the labels of a variable and the codes they belong to", () => {
    expect(parseSavLabels(bytes("survey.sav"))).toEqual(expected);
  });
  it("finds nothing in a file that is not SPSS, or is cut short", () => {
    expect(parseSavLabels(new Uint8Array(500))).toEqual([]);
    expect(parseSavLabels(bytes("survey.sav").subarray(0, 300))).toEqual([]);
  });
});

describe("Stata labels", () => {
  const read = (data: Uint8Array) => async (start: number, end: number) => data.subarray(start, end);
  it("reads the labels of a variable and the codes they belong to", async () => {
    expect(await parseDtaLabels(read(bytes("survey.dta")))).toEqual(expected);
  });
  it("finds nothing in a file that is not Stata", async () => {
    expect(await parseDtaLabels(read(new Uint8Array(2000)))).toEqual([]);
  });
});

describe.skipIf(!python)("against pyreadstat", () => {
  it("a richer SPSS and Stata file give the labels pyreadstat sees", async () => {
    const out = execFileSync("python", [join(process.cwd(), "tests/helpers/make-labelled.py"), join(process.cwd(), "test-results")], { encoding: "utf8" });
    const truth = JSON.parse(out) as { sav: string; dta: string; labels: Record<string, Record<string, string>> };
    const flat = (labels: Record<string, Record<string, string>>) =>
      Object.entries(labels)
        .flatMap(([column, map]) => Object.entries(map).map(([value, label]) => `${column}|${value}|${label}`))
        .sort();
    const fromEntries = (entries: { column: string; value: string; label: string }[]) => entries.map((e) => `${e.column}|${e.value}|${e.label}`).sort();
    const sav = parseSavLabels(new Uint8Array(readFileSync(truth.sav)));
    expect(fromEntries(sav)).toEqual(flat(truth.labels));
    const dtaBytes = new Uint8Array(readFileSync(truth.dta));
    const dta = await parseDtaLabels(async (s, e) => dtaBytes.subarray(s, e));
    expect(fromEntries(dta)).toEqual(flat(truth.labels));
  });
});
