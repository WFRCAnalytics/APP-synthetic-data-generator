// @vitest-environment node
// A designed table written in every file type (specs/009 FR-002 to FR-006, SC-001, SC-002): the design becomes a spec whose
// source is the chosen format, the matching writer produces a file, and the file is read back with an independent reader
// (the engine's readers for Parquet and JSON, a JSON parser, the workbook's own XML). The CSV is the one it always was.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { specFromDesign } from "../../src/lib/design/build";
import { defaultColumn, emptyDesign } from "../../src/lib/design/defaults";
import type { Design, DesignColumn, DesignOutput } from "../../src/lib/design/types";
import { writeJson } from "../../src/lib/generate/json";
import { writeParquet } from "../../src/lib/generate/parquet";
import { renderAll } from "../../src/lib/generate/render";
import { planTable } from "../../src/lib/generate/table";
import { writeWorkbook } from "../../src/lib/generate/xlsx";
import { readEntryText, readZipDirectory } from "../../src/lib/xlsx/zip";
import { createNodeDb, type NodeDb } from "../helpers/duckdbNode";

const ROWS = 300;

function columns(): DesignColumn[] {
  const taken: string[] = [];
  const make = <K extends Parameters<typeof defaultColumn>[0]>(kind: K, over: Record<string, unknown>) => {
    const c = { ...defaultColumn(kind, taken), ...over } as DesignColumn;
    taken.push(c.name);
    return c;
  };
  return [
    make("integer", { name: "age", min: 18, max: 90, missingPct: 10 }),
    make("decimal", { name: "income", min: 1000, max: 90000, decimals: 2 }),
    make("category", { name: "mode", labels: [{ label: "car", weight: 5 }, { label: "bus", weight: 3 }, { label: "walk", weight: 2 }] }),
    make("yesno", { name: "has_pass", yesPct: 30 }),
    make("yesno", { name: "owns", yesLabel: "Owner", noLabel: "Renter" }),
    make("date", { name: "trip_date", start: "2023-01-01", end: "2023-03-31", format: "%Y-%m-%d" }),
    make("datetime", { name: "stamp", start: "2023-01-01", end: "2023-01-31", format: "%Y-%m-%d %H:%M:%S" }),
    make("id", { name: "hh_id", prefix: "H-", digits: 5 }),
    make("personal", { name: "who" }),
    make("text", { name: "note", minLength: 5, maxLength: 40 }),
  ];
}

const design = (output: DesignOutput, over: Partial<Design> = {}): Design => ({ ...emptyDesign(), tableName: "trips", output, rows: ROWS, columns: columns(), ...over });

function specOf(output: DesignOutput, over: Partial<Design> = {}) {
  const r = specFromDesign(design(output, over));
  if (!r.ok) throw new Error(r.problems.map((p) => p.message).join("; "));
  return r.spec;
}

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

let db: NodeDb;
beforeAll(async () => {
  db = await createNodeDb();
  await db.sql.run("LOAD parquet");
  await db.sql.run("LOAD json");
}, 60_000);
afterAll(() => db?.close());

describe("the source of each file type", () => {
  it.each([
    ["csv", "csv", "trips.csv"],
    ["xlsx", "xlsx", "trips.xlsx"],
    ["parquet", "parquet", "trips.parquet"],
    ["json", "json", "trips.json"],
    ["ndjson", "json", "trips.ndjson"],
  ] as const)("%s becomes a %s source called %s, and the spec validates", (output, format, file) => {
    const spec = specOf(output);
    expect(spec.source.format).toBe(format);
    expect(spec.source.file_name).toBe(file);
  });

  it("makes a JSON list or JSON Lines as asked", () => {
    expect(specOf("json").source).toMatchObject({ form: "array", indent: "2" });
    expect(specOf("ndjson").source).toMatchObject({ form: "lines", indent: "compact" });
  });

  it("names the workbook sheet after the table, with the characters a sheet cannot hold replaced", () => {
    expect(specOf("xlsx").source).toMatchObject({ sheet: "trips" });
    expect(specOf("xlsx", { tableName: "a[b]c" }).source).toMatchObject({ sheet: "a_b_c" });
    expect(specOf("xlsx", { tableName: "x".repeat(60) }).source).toMatchObject({ sheet: "x".repeat(31) });
  });

  it("keeps a CSV design as it was", () => {
    expect(specOf("csv").source).toMatchObject({ format: "csv", delimiter: ",", header: true });
    expect(specOf("csv").columns.some((c) => "json_kind" in c || "parquet_type" in c || "cell_format" in c)).toBe(false);
  });
});

describe("the description of each column", () => {
  it("gives a workbook number and date formats", () => {
    const by = Object.fromEntries(specOf("xlsx").columns.map((c) => [c.name, c]));
    expect(by.age.cell_format).toBe("0");
    expect(by.income.cell_format).toBe("0.00");
    expect(by.trip_date.cell_format).toBe("yyyy-mm-dd");
    expect(by.stamp.cell_format).toBe("yyyy-mm-dd hh:mm:ss");
    expect(by.mode.cell_format).toBeUndefined();
  });

  it("gives Parquet the smallest integer that holds the range, a double, a date, a timestamp, and strings", () => {
    const by = Object.fromEntries(specOf("parquet").columns.map((c) => [c.name, c]));
    expect(by.age.parquet_type).toEqual({ kind: "int", bits: 8, signed: true, nullable: true });
    expect(by.income.parquet_type).toEqual({ kind: "float", bits: 64, nullable: true });
    expect(by.trip_date.parquet_type).toEqual({ kind: "date", nullable: true });
    expect(by.stamp.parquet_type).toEqual({ kind: "timestamp", unit: "us", utc: false, nullable: true });
    expect(by.mode.parquet_type).toEqual({ kind: "string", nullable: true });
    expect(by.hh_id.parquet_type).toEqual({ kind: "string", nullable: true });
  });

  it("widens the Parquet integer for a larger range", () => {
    const wide = (min: number, max: number) => {
      const d = design("parquet", { columns: [{ ...(defaultColumn("integer") as DesignColumn), name: "n", min, max } as DesignColumn] });
      const r = specFromDesign(d);
      if (!r.ok) throw new Error("not valid");
      return r.spec.columns[0].parquet_type;
    };
    expect(wide(0, 1000)).toMatchObject({ bits: 16 });
    expect(wide(0, 100000)).toMatchObject({ bits: 32 });
    expect(wide(0, 10_000_000_000)).toMatchObject({ bits: 64 });
  });

  it("gives JSON numbers, text and true or false, and text for a yes or no with other labels", () => {
    const by = Object.fromEntries(specOf("json").columns.map((c) => [c.name, c]));
    expect(by.age.json_kind).toBe("number");
    expect(by.income.json_kind).toBe("number");
    expect(by.has_pass.json_kind).toBe("boolean");
    expect(by.owns.json_kind).toBe("string");
    expect(by.trip_date.json_kind).toBe("string");
    expect(by.who.json_kind).toBe("string");
  });
});

describe("the files", () => {
  it("writes a CSV with the header, the rows and the designed columns", () => {
    const spec = specOf("csv");
    const text = new TextDecoder().decode(renderAll(planTable(spec, spec.seed)));
    const lines = text.trimEnd().split("\n");
    expect(lines).toHaveLength(ROWS + 1);
    expect(lines[0]).toBe("age,income,mode,has_pass,owns,trip_date,stamp,hh_id,who,note");
  });

  it("writes a JSON list the parser reads, with numbers, booleans, text and nulls as designed", async () => {
    const spec = specOf("json");
    const text = new TextDecoder().decode(await collect(writeJson(spec, spec.seed, 100).chunks));
    const records = JSON.parse(text) as Record<string, unknown>[];
    expect(records).toHaveLength(ROWS);
    expect(Object.keys(records[0])).toEqual(["age", "income", "mode", "has_pass", "owns", "trip_date", "stamp", "hh_id", "who", "note"]);
    for (const r of records) {
      expect(typeof r.income).toBe("number");
      expect(typeof r.has_pass).toBe("boolean");
      expect(["Owner", "Renter"]).toContain(r.owns);
      expect(r.trip_date).toMatch(/^2023-\d{2}-\d{2}$/);
      if (r.age !== null) expect(Number.isInteger(r.age)).toBe(true);
    }
    expect(records.filter((r) => r.age === null)).toHaveLength(30); // 10% of 300 rows, written as null
    expect(records.filter((r) => r.has_pass === true)).toHaveLength(90);
  });

  it("writes JSON Lines, one record per line", async () => {
    const spec = specOf("ndjson");
    const text = new TextDecoder().decode(await collect(writeJson(spec, spec.seed, 100).chunks));
    const lines = text.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(ROWS);
    expect(text.startsWith("[")).toBe(false);
    for (const l of lines.slice(0, 5)) expect(Object.keys(JSON.parse(l))[0]).toBe("age");
  });

  it("writes a Parquet file the engine reads, with the designed types and the missing values as nulls", async () => {
    const spec = specOf("parquet");
    const run = writeParquet(spec, spec.seed, 100, { createdBy: "synthetic-data-generator test", codec: "gzip", rowGroupRows: 128 });
    db.registerBuffer("designed.parquet", await collect(run.chunks));
    const types = await db.sql.all("DESCRIBE SELECT * FROM read_parquet('designed.parquet')");
    const by = Object.fromEntries(types.map((r) => [String(r.column_name), String(r.column_type)]));
    expect(by).toMatchObject({ age: "TINYINT", income: "DOUBLE", mode: "VARCHAR", trip_date: "DATE", stamp: "TIMESTAMP", hh_id: "VARCHAR" });
    const [counts] = await db.sql.all("SELECT count(*) AS n, count(*) FILTER (WHERE age IS NULL) AS missing, min(age) AS lo, max(age) AS hi FROM read_parquet('designed.parquet')");
    expect(counts).toMatchObject({ n: ROWS, missing: 30 });
    expect(Number(counts.lo)).toBeGreaterThanOrEqual(18);
    expect(Number(counts.hi)).toBeLessThanOrEqual(90);
  });

  it("writes a workbook with one sheet, a header row, numbers and dates as cells, and blanks for missing values", async () => {
    const spec = specOf("xlsx");
    const bytes = await collect(writeWorkbook(spec, spec.seed, 100).chunks);
    const blob = new Blob([bytes as BlobPart]);
    const entries = await readZipDirectory(blob);
    expect(entries.map((e) => e.name)).toContain("xl/worksheets/sheet1.xml");
    const book = await readEntryText(blob, entries.find((e) => e.name === "xl/workbook.xml")!);
    expect(book).toContain('name="trips"');
    const sheet = await readEntryText(blob, entries.find((e) => e.name === "xl/worksheets/sheet1.xml")!);
    expect((sheet.match(/<row /g) ?? []).length).toBe(ROWS + 1);
    const styles = await readEntryText(blob, entries.find((e) => e.name === "xl/styles.xml")!);
    expect(styles).toContain("yyyy-mm-dd");
    expect(styles).toContain("0.00");
  });
});

describe("determinism", () => {
  it.each(["json", "ndjson"] as const)("%s gives the same bytes for the same design and seed", async (output) => {
    const a = specOf(output);
    const b = specOf(output);
    const x = await collect(writeJson(a, a.seed, 100).chunks);
    const y = await collect(writeJson(b, b.seed, 37).chunks);
    expect(Buffer.from(x).equals(Buffer.from(y))).toBe(true);
  });

  it("a Parquet file has the same bytes twice", async () => {
    const spec = specOf("parquet");
    const make = () => collect(writeParquet(spec, spec.seed, 100, { createdBy: "x", codec: "none", rowGroupRows: 128 }).chunks);
    expect(Buffer.from(await make()).equals(Buffer.from(await make()))).toBe(true);
  });
});
