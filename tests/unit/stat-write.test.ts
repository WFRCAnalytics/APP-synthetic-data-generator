// @vitest-environment node
// Writing SPSS and Stata files (specs/018): the files are read back with an independent reader (pyreadstat) and must hold
// the same table; the structure is also checked here, so the test is useful where Python is not installed.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeDta } from "../../src/lib/stat/dta";
import { writeSav } from "../../src/lib/stat/sav";
import { tableFromCsv } from "../../src/lib/stat/table";

const csv = [
  "hh_id,age,income,trip_date,start,when,note,mode",
  'H1,34,52000.5,2024-03-05,08:30:00,2024-03-05 08:30:00,"a, b",2',
  "H2,,61000,2024-12-31,23:59:59,2024-12-31 23:59:59,café,1",
  "H3,70,,,,,,3",
  "",
].join("\n");
const hints = { hh_id: "survey_id", age: "integer", income: "float", trip_date: "date", start: "time", when: "datetime", note: "free_text", mode: "categorical" };

const python = spawnSync("python", ["-c", "import pyreadstat"]).status === 0;

function readBack(file: string, bytes: Uint8Array) {
  const dir = mkdtempSync(join(tmpdir(), "statw-"));
  const path = join(dir, file);
  writeFileSync(path, bytes);
  return JSON.parse(execFileSync("python", [join(process.cwd(), "tests/helpers/readstat.py"), path], { encoding: "utf8" })) as { names: string[]; rows: number; cells: unknown[][]; labels: Record<string, string | null>; value_labels: Record<string, Record<string, string>> };
}

describe("the typed table", () => {
  const table = tableFromCsv(csv, hints, 255);
  it("reads numbers, dates and text by the spec's types", () => {
    expect(table.columns.map((c) => c.kind)).toEqual(["string", "number", "number", "date", "time", "datetime", "string", "number"]);
    expect(table.rowCount).toBe(3);
    expect(table.columns[1].values).toEqual([34, null, 70]);
    expect(table.columns[2].decimals).toBe(1);
  });
  it("keeps a column as text when a cell does not fit its type", () => {
    const t = tableFromCsv("a\n1\nx\n", { a: "integer" }, 255);
    expect(t.columns[0].kind).toBe("string");
  });
  it("cuts text at the limit without splitting a character", () => {
    const t = tableFromCsv("a\nééé\n", { a: "free_text" }, 5);
    expect(t.columns[0].values).toEqual(["éé"]);
    expect(t.truncated).toBe(1);
  });
});

describe.skipIf(!python)("read back with pyreadstat", () => {
  const table = tableFromCsv(csv, hints, 255);
  const expected = (back: ReturnType<typeof readBack>) => {
    expect(back.names).toEqual(["hh_id", "age", "income", "trip_date", "start", "when", "note", "mode"]);
    expect(back.rows).toBe(3);
    expect(back.cells[0][0]).toBe("H1");
    expect(back.cells[0][1]).toBe(34);
    expect(back.cells[0][2]).toBe(52000.5);
    expect(back.cells[1][1]).toBeNull();
    expect(back.cells[2][2]).toBeNull();
    expect(back.cells[1][6]).toBe("café");
    expect(back.cells[0][6]).toBe("a, b");
    expect(back.cells[0][7]).toBe(2);
  };

  it("an SPSS file holds the same table", () => {
    const back = readBack("t.sav", writeSav(table));
    expected(back);
    expect(String(back.cells[0][3])).toContain("2024-03-05");
    expect(String(back.cells[1][5])).toContain("2024-12-31");
  });

  it("a Stata file holds the same table", () => {
    const back = readBack("t.dta", writeDta(table));
    expected(back);
    expect(String(back.cells[0][3])).toContain("2024-03-05");
    expect(String(back.cells[1][5])).toContain("2024-12-31");
  });

  const meta = { age: { description: "Age of the respondent" }, mode: { description: "How the trip was made", valueLabels: { "1": "Car", "2": "Bus", "3": "Café é" } }, hh_id: { description: "Household" } };
  const labelled = tableFromCsv(csv, hints, 255, meta);

  for (const [file, write] of [["l.sav", writeSav], ["l.dta", writeDta]] as const) {
    it(`${file}: variable labels and the value labels of a number column are read back`, () => {
      const back = readBack(file, write(labelled));
      expect(back.labels.age).toBe("Age of the respondent");
      expect(back.labels.mode).toBe("How the trip was made");
      expect(back.labels.hh_id).toBe("Household");
      expect(back.value_labels).toEqual({ mode: { "1": "Car", "2": "Bus", "3": "Café é" } });
      expected(back); // the values themselves are untouched
    });
  }

  it("labels are only written where the format can hold them", () => {
    // A label for a column that is text (hh_id) is dropped; a label on a decimal code is dropped for Stata.
    const t = tableFromCsv(csv, hints, 255, { hh_id: { valueLabels: { H1: "First" } }, income: { valueLabels: { "1.5": "x" } } });
    expect(t.columns[0].valueLabels).toBeUndefined();
    expect(readBack("t.dta", writeDta(t)).value_labels).toEqual({});
  });

  it("names that the format cannot take are made valid and stay unique", () => {
    const t = tableFromCsv("my col,my col,1st\n1,2,3\n", { "my col": "integer", "1st": "integer" }, 255);
    const sav = readBack("n.sav", writeSav(t));
    const dta = readBack("n.dta", writeDta(t));
    expect(new Set(sav.names).size).toBe(3);
    expect(new Set(dta.names).size).toBe(3);
    expect(dta.names.every((n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n))).toBe(true);
  });
});

describe("the files", () => {
  const table = tableFromCsv(csv, hints, 255);
  it("start with the format's own signature and are the same bytes twice", () => {
    expect(new TextDecoder().decode(writeSav(table).subarray(0, 4))).toBe("$FL2");
    expect(new TextDecoder().decode(writeDta(table).subarray(0, 11))).toBe("<stata_dta>");
    expect(Buffer.from(writeSav(table)).equals(Buffer.from(writeSav(table)))).toBe(true);
    expect(Buffer.from(writeDta(table)).equals(Buffer.from(writeDta(table)))).toBe(true);
  });
});
