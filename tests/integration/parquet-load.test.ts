// @vitest-environment node
// Loading Parquet files the way the profile worker does (specs/005 FR-001 to FR-004, FR-008, FR-013, FR-015,
// research R2, R5, R7): structure from the file, the all-text table that profiling reads, nested and
// unsupported columns that are never read, and the files that are refused. The Excel extension cannot load in
// Node, but Parquet can, so this runs the real loader against the real fixtures.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classifyParquet } from "../../src/lib/parquet/detect";
import { EMPTY_TEXT_TOKEN } from "../../src/lib/spec/types";
import { profileAll } from "../../src/workers/profile/profiler";
import { inspectParquet, loadParquet } from "../../src/workers/profile/parquet";
import { createSample } from "../../src/workers/profile/stats";
import { buildParquet } from "../helpers/parquetFile";
import { createNodeDb, type NodeDb } from "../helpers/duckdbNode";

const dir = join(process.cwd(), "tests/fixtures/parquet");
let db: NodeDb;

const register = (name: string) => db.registerBuffer(name, new Uint8Array(readFileSync(join(dir, name))));

beforeAll(async () => {
  db = await createNodeDb();
  await db.sql.run("LOAD parquet");
  for (const f of ["types_snappy", "types_gzip", "types_zstd", "types_none", "plain", "required", "wide", "empty", "names", "unsupported_scalars", "not_parquet", "truncated", "encrypted"]) register(`${f}.parquet`);
}, 60_000);
afterAll(() => db?.close());

describe("structure", () => {
  it.each(["snappy", "gzip", "zstd", "none"])("reads a %s file: counts, names and types, without a value", async (codec) => {
    const info = await inspectParquet(db.sql, `types_${codec}.parquet`);
    expect(info.rowCount).toBe(5000);
    expect(info.rowGroups).toBe(3);
    expect(info.expandedBytes).toBeGreaterThan(10_000);
    expect(info.columns.map((c) => c.name)).toEqual(["id16", "id64", "u8", "f32", "f64", "amount", "flag", "name", "day", "ts", "tsz", "tags", "pt", "kv"]);
    const byName = Object.fromEntries(info.columns.map((c) => [c.name, c]));
    expect(byName.id16.type).toEqual({ kind: "int", bits: 16, signed: true, nullable: true });
    expect(byName.id64.type).toEqual({ kind: "int", bits: 64, signed: true, nullable: false });
    expect(byName.u8.type).toEqual({ kind: "int", bits: 8, signed: false, nullable: true });
    expect(byName.f32.type).toEqual({ kind: "float", bits: 32, nullable: true });
    expect(byName.amount.type).toEqual({ kind: "decimal", precision: 10, scale: 2, nullable: true });
    expect(byName.flag.type).toEqual({ kind: "bool", nullable: true });
    expect(byName.name.type).toEqual({ kind: "string", nullable: true });
    expect(byName.day.type).toEqual({ kind: "date", nullable: true });
    expect(byName.ts.type).toEqual({ kind: "timestamp", unit: "us", utc: false, nullable: true });
    expect(byName.tsz.type).toEqual({ kind: "timestamp", unit: "ms", utc: true, nullable: true });
  });

  it("marks list, struct and map columns unsupported with the kind, and gives them no type", async () => {
    const info = await inspectParquet(db.sql, "types_snappy.parquet");
    const nested = info.columns.filter((c) => c.unsupported);
    expect(nested.map((c) => [c.name, c.unsupported, c.type])).toEqual([["tags", "nested_list", null], ["pt", "nested_struct", null], ["kv", "nested_map", null]]);
  });

  it("marks raw binary and fixed binary unsupported", async () => {
    const info = await inspectParquet(db.sql, "unsupported_scalars.parquet");
    expect(info.columns.map((c) => [c.name, c.unsupported])).toEqual([["id", null], ["raw", "binary"], ["fixed", "binary"]]);
  });

  it("takes required columns as not nullable", async () => {
    const info = await inspectParquet(db.sql, "required.parquet");
    expect(info.columns.map((c) => c.type?.nullable)).toEqual([false, false, false]);
  });

  it("reads a wide file", async () => {
    const info = await inspectParquet(db.sql, "wide.parquet");
    expect(info.columns).toHaveLength(300);
    expect(info.rowCount).toBe(400);
    expect(info.rowGroups).toBe(2);
  });

  it("uses the engine's names for empty and duplicated column names", async () => {
    const info = await inspectParquet(db.sql, "names.parquet");
    const names = info.columns.map((c) => c.name);
    expect(new Set(names).size).toBe(3);
    expect(names.every((n) => n.length > 0)).toBe(true);
  });
});

describe("refusals, each with a fixed message", () => {
  it("refuses a file with no rows", async () => {
    await expect(inspectParquet(db.sql, "empty.parquet")).rejects.toMatchObject({ code: "parquet_empty" });
  });

  it("refuses a file cut short or not Parquet, saying nothing from the file", async () => {
    for (const name of ["truncated.parquet", "not_parquet.parquet"]) {
      const error = await inspectParquet(db.sql, name).catch((e) => e);
      expect(error.code, name).toBe("parquet_damaged");
      expect(error.message, name).not.toMatch(/truncated|not_parquet|magic|LINE/);
    }
  });

  it("tells the kinds of file apart by their first and last bytes, not their names", () => {
    const read = (name: string) => {
      const bytes = new Uint8Array(readFileSync(join(dir, name)));
      return classifyParquet(bytes.subarray(0, 8), bytes.subarray(bytes.length - 8));
    };
    expect(read("types_snappy.parquet")).toBe("parquet");
    expect(read("types_zstd.parquet")).toBe("parquet");
    expect(read("truncated.parquet")).toBe("damaged");
    expect(read("not_parquet.parquet")).toBe("not_parquet");
    expect(read("encrypted.parquet")).toBe("encrypted");
    expect(classifyParquet(new Uint8Array(), new Uint8Array())).toBe("not_parquet");
    expect(classifyParquet(Uint8Array.of(0x50, 0x41, 0x52), Uint8Array.of(0x50, 0x41, 0x52))).toBe("not_parquet");
  });
});

describe("the all-text table", () => {
  it("holds every row, with nested columns as all-NULL and nothing read from them", async () => {
    const info = await inspectParquet(db.sql, "types_snappy.parquet");
    const loaded = await loadParquet(db.sql, "types_snappy.parquet", info);
    expect(loaded.rowCount).toBe(5000);
    expect(loaded.columnNames).toHaveLength(14);
    const [n] = await db.sql.all(`SELECT count(tags) AS tags, count(pt) AS pt, count(kv) AS kv, count(id64) AS ids FROM src`);
    expect(n).toEqual({ tags: 0, pt: 0, kv: 0, ids: 5000 });
  });

  it("turns each kind into the text a CSV would hold", async () => {
    const info = await inspectParquet(db.sql, "types_snappy.parquet");
    await loadParquet(db.sql, "types_snappy.parquet", info);
    const [r] = await db.sql.all(`SELECT id16, id64, u8, f32, f64, amount, flag, name, day, ts, tsz FROM src ORDER BY CAST(id64 AS BIGINT) LIMIT 1 OFFSET 1`);
    expect(r).toEqual({
      id16: "1",
      id64: "1001",
      u8: "1",
      f32: "0.5",
      f64: "1.251",
      amount: "0.01",
      flag: "FALSE",
      name: "PRIVATE-MARKER person 1",
      day: "2020-01-02",
      ts: "2021-05-01 08:31:00",
      tsz: "2022-05-01 00:01:00",
    });
  });

  it("keeps nulls as NULL and counts them", async () => {
    const info = await inspectParquet(db.sql, "types_snappy.parquet");
    await loadParquet(db.sql, "types_snappy.parquet", info);
    const [r] = await db.sql.all(`SELECT count(*) FILTER (WHERE id16 IS NULL) AS id16, count(*) FILTER (WHERE name IS NULL) AS name FROM src`);
    expect(r).toEqual({ id16: 715, name: 455 }); // every 7th and every 11th row of 5,000, starting at row 0
  });

  it("tells empty text from a null: the first becomes the empty-text token", async () => {
    const { bytes } = await buildParquet([{ name: "s", type: { kind: "string", nullable: true } }], [["a"], [""], [EMPTY_TEXT_TOKEN], ["b"]]);
    db.registerBuffer("empties.parquet", bytes);
    const info = await inspectParquet(db.sql, "empties.parquet");
    await loadParquet(db.sql, "empties.parquet", info);
    const rows = await db.sql.all(`SELECT s FROM src`);
    expect(rows.map((r) => (r.s === null ? "NULL" : r.s === EMPTY_TEXT_TOKEN ? "TOKEN" : r.s))).toEqual(["a", "NULL", "TOKEN", "b"]);
  });

  it("profiles to the same column types a CSV of these values would", async () => {
    const info = await inspectParquet(db.sql, "plain.parquet");
    const loaded = await loadParquet(db.sql, "plain.parquet", info);
    await createSample(db.sql, loaded.rowCount);
    const profiles = await profileAll(db.sql, loaded.columnNames, loaded.rowCount, { threshold: 50 });
    const byName = Object.fromEntries(profiles.map((p) => [p.name, p.type]));
    expect(byName.id64).toBe("integer");
    expect(byName.f64).toBe("float");
    expect(byName.day).toBe("date");
    expect(["short_string", "personal", "free_text", "categorical"]).toContain(byName.name);
  });
});
