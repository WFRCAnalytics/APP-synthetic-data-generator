// @vitest-environment node
// Golden bytes (specs/008 FR-003, SC-002): for a fixed spec and seed, the content written in each format must not change
// when a tool is upgraded. CSV and JSON are hashed as bytes. A Parquet file is written uncompressed, and a workbook's
// sheet is hashed as its XML, so a new zlib in the runtime cannot change the result while the content stays the same.
// If a hash changes, the generators or writers changed; update it only when that is intended.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { writeJson } from "../../src/lib/generate/json";
import { writeParquet } from "../../src/lib/generate/parquet";
import { renderAll } from "../../src/lib/generate/render";
import { planTable } from "../../src/lib/generate/table";
import { writeWorkbook } from "../../src/lib/generate/xlsx";
import { readEntryText, readZipDirectory } from "../../src/lib/xlsx/zip";
import { SPEC_VERSION, type ColumnSpec, type SpecFile } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";

const N = 600;
const q = (lo: number, hi: number) => Array.from({ length: 101 }, (_, i) => lo + ((hi - lo) * i) / 100);
const sha = (bytes: Uint8Array | string) => {
  const hex = createHash("sha256").update(bytes).digest("hex");
  if (process.env.GOLDEN_PRINT) console.log("GOLDEN", hex);
  return hex;
};

const columns: ColumnSpec[] = [
  { name: "id", type: "survey_id", mask: ["upper", { literal: "-" }, "digit", "digit", "digit"], repeat_structure: { "1": N } },
  { name: "age", type: "integer", mode: "match_shape", min: 18, max: 90, mean: 45, sd: 15, decimals: 0, quantiles: q(18, 90), na: { tokens: [""], count: 30 } },
  { name: "income", type: "float", mode: "match_mean_sd", min: 1000, max: 90000, mean: 40000, sd: 9000, decimals: 2 },
  { name: "mode", type: "categorical", storage: "string", counts: { bus: 150, car: 300, walk: 120 }, na: { tokens: [""], count: 30 } },
  { name: "ok", type: "boolean", storage: "string", counts: { TRUE: 250, FALSE: 350 } },
  { name: "when", type: "date", mode: "uniform", min: 19000, max: 19400, format: "%Y-%m-%d", granularity: "day" },
  { name: "who", type: "personal", kind: "full_name", repeat_structure: { "1": N } },
  { name: "note", type: "free_text", mode: "uniform", min: 5, max: 60, decimals: 0, line_breaks: false },
];

const withKinds = (extra: (c: ColumnSpec) => Partial<ColumnSpec>): ColumnSpec[] => columns.map((c) => ({ ...c, ...extra(c) }) as ColumnSpec);

const jsonKind = (c: ColumnSpec) => (c.type === "integer" || c.type === "float" ? "number" : c.type === "boolean" ? "boolean" : "string");
const parquetType = (c: ColumnSpec) =>
  c.type === "integer" ? { kind: "int", bits: 32, signed: true, nullable: true } : c.type === "float" ? { kind: "float", bits: 64, nullable: true } : c.type === "date" ? { kind: "date", nullable: true } : c.type === "boolean" ? { kind: "bool", nullable: true } : { kind: "string", nullable: true };

const spec = (source: SpecFile["source"], cols: ColumnSpec[]): SpecFile => {
  const s: SpecFile = { spec_version: SPEC_VERSION, source, n_rows: N, seed: 4242, columns: cols };
  const r = validateSpec(s);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return s;
};

async function collect(chunks: AsyncGenerator<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const c of chunks) parts.push(c.slice());
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe("the bytes written for a fixed spec and seed", () => {
  it("CSV", () => {
    const s = spec({ format: "csv", file_name: "t.csv", encoding: "utf-8", delimiter: ",", quote: '"', header: true }, columns);
    expect(sha(renderAll(planTable(s, 4242)))).toBe(GOLDEN.csv);
  });

  it("JSON, as an indented array and as one record per line", async () => {
    const cols = withKinds((c) => ({ json_kind: jsonKind(c), json_missing: c.name === "age" ? 10 : 0 }));
    const array = spec({ format: "json", file_name: "t.json", form: "array", indent: "2", line_ending: "lf", trailing_newline: true, bom: false }, cols);
    expect(sha(await collect(writeJson(array, 4242, 100).chunks))).toBe(GOLDEN.jsonArray);
    const lines = spec({ format: "json", file_name: "t.ndjson", form: "lines", indent: "compact", line_ending: "lf", trailing_newline: true, bom: false }, cols);
    expect(sha(await collect(writeJson(lines, 4242, 100).chunks))).toBe(GOLDEN.jsonLines);
  });

  it("Parquet, uncompressed", async () => {
    const cols = withKinds((c) => ({ parquet_type: parquetType(c) }) as Partial<ColumnSpec>);
    const s = spec({ format: "parquet", file_name: "t.parquet", row_groups: 2 }, cols);
    const run = writeParquet(s, 4242, 100, { createdBy: "synthetic-data-generator golden", codec: "none", rowGroupRows: 250 });
    expect(sha(await collect(run.chunks))).toBe(GOLDEN.parquet);
  });

  it("the sheet of a workbook", async () => {
    const s = spec({ format: "xlsx", file_name: "t.xlsx", sheet: "Survey", skip_rows: 0, header: true, date1904: false }, columns);
    const bytes = await collect(writeWorkbook(s, 4242, 100).chunks);
    const blob = new Blob([bytes as BlobPart]);
    const entries = await readZipDirectory(blob);
    const sheet = await readEntryText(blob, entries.find((e) => e.name === "xl/worksheets/sheet1.xml")!);
    expect(sha(sheet)).toBe(GOLDEN.xlsxSheet);
  });
});

const GOLDEN = {
  csv: "86ceb52cfa558670a7a186f836e0703294d6f9a66f5e877a20689f95db2f92f7",
  jsonArray: "7a42a7e63edea6093de462eebda7bbbba0a758b9d5337b135f318fa2ab4e2535",
  jsonLines: "fef668ad19c90b63990b414ab450ecdb6e229348672ab431f409bd7bfa1c02e1",
  parquet: "ee63c921e089883e91ea82ff5a12273c7200e156857d1c90efb2429f6e84986d",
  xlsxSheet: "5bbd291fbeee3a8cf056fe6d3c3b3803fc5075155fde4f067f02fd5555ef044a",
};
