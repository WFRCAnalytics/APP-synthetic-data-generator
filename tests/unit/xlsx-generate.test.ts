// @vitest-environment node
// Generating a workbook from a spec (specs/003 FR-011, FR-012, FR-014): the sheet's name, header
// position, column kinds and formats come from the spec, the values follow the same generators as a
// CSV, and the same seed gives the same cells whatever the chunk size.

import { describe, expect, it } from "vitest";
import { CheckAccumulator } from "../../src/lib/generate/checks";
import { writeWorkbook } from "../../src/lib/generate/xlsx";
import { EMPTY_TEXT_TOKEN, SPEC_VERSION, type ColumnSpec, type SpecFile } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";
import { inspectSheet, inspectWorkbook } from "../../src/lib/xlsx/metadata";
import { readEntryText, readZipDirectory } from "../../src/lib/xlsx/zip";

const N = 300;
const q = (lo: number, hi: number) => Array.from({ length: 101 }, (_, i) => lo + ((hi - lo) * i) / 100);

const columns: ColumnSpec[] = [
  { name: "resp_id", type: "survey_id", mask: ["digit", "digit", "digit", "digit", "digit"], pad_width: 5, min: 0, max: 99999, repeat_structure: { "1": N }, cell_format: "@" },
  { name: "amount", type: "float", mode: "match_shape", min: 10, max: 500, mean: 200, sd: 90, decimals: 2, quantiles: q(10, 500), cell_format: "#,##0.00", na: { tokens: [""], count: 20 } },
  { name: "when", type: "date", mode: "uniform", min: 19000, max: 19400, format: "%Y-%m-%d", granularity: "day", cell_format: "mm/dd/yyyy" },
  { name: "flag", type: "categorical", storage: "string", counts: { N: 130, Y: 130 }, na: { tokens: ["", EMPTY_TEXT_TOKEN], count: 40, by_token: { "": 25, [EMPTY_TEXT_TOKEN]: 15 } } },
  { name: "who", type: "personal", kind: "full_name", repeat_structure: { "1": N } },
  { name: "ok", type: "boolean", storage: "string", counts: { TRUE: 150, FALSE: 150 } },
];

const spec = (over: Partial<SpecFile> = {}): SpecFile => ({
  spec_version: SPEC_VERSION,
  source: { format: "xlsx", file_name: "t.xlsx", sheet: "Survey Data", range: "A3:F303", skip_rows: 2, header: true, date1904: false },
  n_rows: N,
  seed: 9,
  columns,
  ...over,
});

async function bytes(s: SpecFile, seed = 9, chunkRows = 64): Promise<Uint8Array> {
  const run = writeWorkbook(s, seed, chunkRows);
  const parts: Uint8Array[] = [];
  for await (const c of run.chunks) parts.push(c);
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const sheetXml = async (data: Uint8Array) => {
  const blob = new Blob([data as BlobPart]);
  const entries = await readZipDirectory(blob);
  return readEntryText(blob, entries.find((e) => e.name === "xl/worksheets/sheet1.xml")!);
};

describe("the spec is valid", () => {
  it("passes validation", () => {
    const r = validateSpec(spec());
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    expect(r.ok).toBe(true);
  });
});

describe("the fake workbook", () => {
  it("has the real sheet's name, header position, width and formats", async () => {
    const blob = new Blob([(await bytes(spec())) as BlobPart]);
    expect((await inspectWorkbook(blob)).sheets.map((s) => s.name)).toEqual(["Survey Data"]);
    const hints = await inspectSheet(blob, "Survey Data");
    expect(hints.suggestedSkipRows).toBe(2);
    expect([hints.firstCol, hints.lastCol]).toEqual([0, 5]);
    expect(hints.formats).toEqual(["@", "#,##0.00", "mm/dd/yyyy", "General", "General", "General"]);
  });

  it("has the header row and one row per table row, below the skipped rows", async () => {
    const xml = await sheetXml(await bytes(spec()));
    expect(xml).toContain('<dimension ref="A3:F303"/>');
    expect(xml).toContain("<t>resp_id</t>");
    expect((xml.match(/<row /g) ?? []).length).toBe(N + 1);
    expect(xml).not.toContain('<row r="1"');
  });

  it("writes each kind as its cell type", async () => {
    const xml = await sheetXml(await bytes(spec()));
    expect(xml).toMatch(/<c r="A4" s="\d+" t="inlineStr"><is><t>\d{5}<\/t><\/is><\/c>/); // padded ID as text
    expect(xml).toMatch(/<c r="B\d+" s="\d+"><v>[\d.]+<\/v><\/c>/); // number
    expect(xml).toMatch(/<c r="C4" s="\d+"><v>\d{5}<\/v><\/c>/); // date serial
    expect(xml).toMatch(/<c r="F\d+" t="b"><v>[01]<\/v><\/c>/); // boolean
    expect(xml).toMatch(/<c r="E4" t="inlineStr"><is><t[^>]*>[^<]+<\/t><\/is><\/c>/); // invented name as text
  });

  it("keeps blank cells and empty text apart, in the recorded numbers", async () => {
    const xml = await sheetXml(await bytes(spec()));
    const rows = xml.match(/<row r="(\d+)">[\s\S]*?<\/row>/g) ?? [];
    let blank = 0;
    let empty = 0;
    for (const row of rows.slice(1)) {
      const flag = /<c r="D\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/.exec(row);
      if (!flag) blank++;
      else if (flag[0].includes("<t></t>")) empty++;
    }
    expect(blank).toBe(25);
    expect(empty).toBe(15);
  });

  it("is the same for the same seed whatever the chunk size, and differs for another seed", async () => {
    const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
    const ref = await bytes(spec(), 9, 64);
    expect(same(await bytes(spec(), 9, 1), ref)).toBe(true);
    expect(same(await bytes(spec(), 9, 1000), ref)).toBe(true);
    expect(same(await bytes(spec(), 10, 64), ref)).toBe(false);
  });

  it("measures the table with the same check rows as a CSV", async () => {
    // The plan exists only once writing starts, so the accumulator is made from a plan of the same spec.
    const probe = writeWorkbook(spec(), 9, 100);
    const checks = new CheckAccumulator(probe.plan);
    const run = writeWorkbook(spec(), 9, 100, (values) => checks.observeRow(values));
    for await (const chunk of run.chunks) void chunk;
    for await (const chunk of probe.chunks) void chunk;
    const rows = checks.finish();
    expect(rows.filter((r) => !r.pass)).toEqual([]);
    expect(rows.some((r) => r.column === "flag" && r.metric === "na_count")).toBe(true);
  });

  it("calls the progress hook after each chunk of rows", async () => {
    const seen: number[] = [];
    const run = writeWorkbook(spec(), 9, 100, undefined, (done) => void seen.push(done));
    for await (const chunk of run.chunks) void chunk;
    expect(seen).toEqual([100, 200, 300]);
  });

  it("stops when the hook throws, as a cancel does", async () => {
    const run = writeWorkbook(spec(), 9, 50, undefined, (done) => {
      if (done >= 100) throw new Error("cancelled");
    });
    await expect((async () => { for await (const chunk of run.chunks) void chunk; })()).rejects.toThrow("cancelled");
  });

  it("writes the 1904 system when the source has it", async () => {
    const blob = new Blob([(await bytes(spec({ source: { format: "xlsx", file_name: "t.xlsx", sheet: "S", range: "A3:F303", skip_rows: 2, header: true, date1904: true } }))) as BlobPart]);
    expect((await inspectWorkbook(blob)).date1904).toBe(true);
  });

  it("refuses a CSV spec", () => {
    const csv = spec({ source: { format: "csv", file_name: "t.csv", encoding: "utf-8", delimiter: ",", header: true } });
    expect(() => writeWorkbook(csv, 1, 10)).toThrow();
  });
});
