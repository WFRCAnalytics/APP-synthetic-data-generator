// @vitest-environment node
// Two independent readers open the fake Parquet files this app writes (specs/005 FR-006, FR-007, FR-010,
// SC-001): the engine's own reader and, when it is installed, pyarrow. They must see the same column names,
// order and types, the same nulls, values inside each type's range, and a footer with nothing from a real file.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ParquetColumn } from "../../src/lib/parquet/writer";
import type { ParquetType } from "../../src/lib/parquet/types";
import { buildParquet } from "../helpers/parquetFile";
import { createNodeDb, type NodeDb } from "../helpers/duckdbNode";

const t = (type: Omit<ParquetType, "nullable"> & { nullable?: boolean }): ParquetType => ({ nullable: true, ...type });

const columns: ParquetColumn[] = [
  { name: "i8", type: t({ kind: "int", bits: 8, signed: true }) },
  { name: "i16", type: t({ kind: "int", bits: 16, signed: true, nullable: false }) },
  { name: "i32", type: t({ kind: "int", bits: 32, signed: true }) },
  { name: "i64", type: t({ kind: "int", bits: 64, signed: true }) },
  { name: "u8", type: t({ kind: "int", bits: 8, signed: false }) },
  { name: "u16", type: t({ kind: "int", bits: 16, signed: false }) },
  { name: "u32", type: t({ kind: "int", bits: 32, signed: false }) },
  { name: "u64", type: t({ kind: "int", bits: 64, signed: false }) },
  { name: "f32", type: t({ kind: "float", bits: 32 }) },
  { name: "f64", type: t({ kind: "float", bits: 64 }) },
  { name: "d9", type: t({ kind: "decimal", precision: 9, scale: 2 }) },
  { name: "d18", type: t({ kind: "decimal", precision: 18, scale: 4 }) },
  { name: "d38", type: t({ kind: "decimal", precision: 38, scale: 10 }) },
  { name: "flag", type: t({ kind: "bool" }) },
  { name: "name", type: t({ kind: "string" }) },
  { name: "day", type: t({ kind: "date" }) },
  { name: "tm", type: t({ kind: "time", unit: "us" }) },
  { name: "ts_us", type: t({ kind: "timestamp", unit: "us", utc: false }) },
  { name: "ts_ms_utc", type: t({ kind: "timestamp", unit: "ms", utc: true }) },
  { name: "tm_ms", type: t({ kind: "time", unit: "ms" }) },
  { name: "ts_ns", type: t({ kind: "timestamp", unit: "ns", utc: false }) },
];

const N = 1200;
const rows: (string | null)[][] = Array.from({ length: N }, (_, i) => [
  i % 9 === 0 ? null : String((i % 255) - 127),
  String((i % 60000) - 30000),
  String(i * 1000),
  String(9_000_000_000_000_000_000n + BigInt(i)),
  String(i % 256),
  String(i % 65536),
  String(4_000_000_000 + i),
  String(18_000_000_000_000_000_000n + BigInt(i)),
  `${i}.5`,
  `${i}.125`,
  `${i % 1000}.25`,
  `${i}.1234`,
  `12345678901234567890.${String(i).padStart(10, "0")}`,
  i % 2 === 0 ? "TRUE" : "FALSE",
  i % 7 === 0 ? null : `person ${i} é`,
  `2024-0${1 + (i % 9)}-1${i % 9}`,
  `0${i % 10}:30:15.000123`,
  `2021-05-01 08:30:00.${String(i).padStart(6, "0")}`,
  `2022-05-01 00:00:00.${String(i % 1000).padStart(3, "0")}`,
  `0${i % 10}:30:15.250`,
  `2021-05-01 08:30:00.${String(i).padStart(9, "0")}`,
]);

let db: NodeDb;
let dir: string;
const files: Record<string, string> = {};

beforeAll(async () => {
  db = await createNodeDb();
  await db.sql.run("LOAD parquet");
  dir = mkdtempSync(join(tmpdir(), "pq readback "));
  for (const codec of ["gzip", "none"] as const) {
    const { bytes } = await buildParquet(columns, rows, { codec, rowGroupRows: 500 });
    db.registerBuffer(`${codec}.parquet`, bytes);
    files[codec] = join(dir, `${codec}.parquet`);
    writeFileSync(files[codec], bytes);
  }
}, 120_000);
afterAll(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const hasPyarrow = spawnSync("python", ["-c", "import pyarrow"]).status === 0;

describe("the engine's reader", () => {
  for (const codec of ["gzip", "none"]) {
    describe(codec, () => {
      const file = `${codec}.parquet`;

      it("reads every row, in three row groups of 500, 500 and 200", async () => {
        const [{ n }] = await db.sql.all(`SELECT count(*) AS n FROM read_parquet('${file}')`);
        expect(n).toBe(N);
        const meta = await db.sql.all(`SELECT num_rows, num_row_groups FROM parquet_file_metadata('${file}')`);
        expect(meta).toEqual([{ num_rows: N, num_row_groups: 3 }]);
      });

      it("sees the same column names, order and types", async () => {
        const described = await db.sql.all(`DESCRIBE SELECT * FROM read_parquet('${file}')`);
        expect(described.map((r) => [r.column_name, r.column_type])).toEqual([
          ["i8", "TINYINT"], ["i16", "SMALLINT"], ["i32", "INTEGER"], ["i64", "BIGINT"],
          ["u8", "UTINYINT"], ["u16", "USMALLINT"], ["u32", "UINTEGER"], ["u64", "UBIGINT"],
          ["f32", "FLOAT"], ["f64", "DOUBLE"], ["d9", "DECIMAL(9,2)"], ["d18", "DECIMAL(18,4)"], ["d38", "DECIMAL(38,10)"],
          ["flag", "BOOLEAN"], ["name", "VARCHAR"], ["day", "DATE"], ["tm", "TIME"], ["ts_us", "TIMESTAMP"], ["ts_ms_utc", "TIMESTAMP WITH TIME ZONE"], ["tm_ms", "TIME"], ["ts_ns", "TIMESTAMP_NS"],
        ]);
      });

      it("keeps required columns required and optional ones optional", async () => {
        const schema = await db.sql.all(`SELECT name, repetition_type FROM parquet_schema('${file}') WHERE name <> 'schema'`);
        expect(schema.find((r) => r.name === "i16")?.repetition_type).toBe("REQUIRED");
        expect(schema.find((r) => r.name === "i8")?.repetition_type).toBe("OPTIONAL");
      });

      it("has as many nulls as were written, and none in the required column", async () => {
        const [n] = await db.sql.all(`SELECT count(*) FILTER (WHERE i8 IS NULL) AS i8_nulls, count(*) FILTER (WHERE name IS NULL) AS name_nulls, count(*) FILTER (WHERE i16 IS NULL) AS i16_nulls FROM read_parquet('${file}')`);
        expect(n).toEqual({ i8_nulls: rows.filter((r) => r[0] === null).length, name_nulls: rows.filter((r) => r[14] === null).length, i16_nulls: 0 });
      });

      it("returns the values that were written, exactly", async () => {
        const [first] = await db.sql.all(`SELECT CAST(i64 AS VARCHAR) AS i64, CAST(u64 AS VARCHAR) AS u64, CAST(u32 AS VARCHAR) AS u32, CAST(d38 AS VARCHAR) AS d38, CAST(d18 AS VARCHAR) AS d18, CAST(f32 AS VARCHAR) AS f32, CAST(day AS VARCHAR) AS day, CAST(tm AS VARCHAR) AS tm, CAST(ts_us AS VARCHAR) AS ts_us, name FROM read_parquet('${file}') LIMIT 1 OFFSET 1`);
        expect(first).toMatchObject({
          i64: "9000000000000000001",
          u64: "18000000000000000001",
          u32: "4000000001",
          d38: "12345678901234567890.0000000001",
          d18: "1.1234",
          f32: "1.5",
          day: "2024-02-11",
          tm: "01:30:15.000123",
          ts_us: "2021-05-01 08:30:00.000001",
          name: "person 1 é",
        });
      });

      it("keeps unsigned 64-bit values above the signed range", async () => {
        const [{ big }] = await db.sql.all(`SELECT max(u64) > 9223372036854775807 AS big FROM read_parquet('${file}')`);
        expect(big).toBe(true);
      });
    });
  }

  it("has this app as the creator, no key-value metadata and no statistics", async () => {
    const [meta] = await db.sql.all(`SELECT created_by FROM parquet_file_metadata('gzip.parquet')`);
    expect(meta.created_by).toBe("synthetic-data-generator 0.0.0-test");
    expect(await db.sql.all(`SELECT * FROM parquet_kv_metadata('gzip.parquet')`)).toEqual([]);
    const stats = await db.sql.all(`SELECT stats_min, stats_max, stats_null_count, bloom_filter_offset FROM parquet_metadata('gzip.parquet')`);
    expect(stats.length).toBeGreaterThan(0);
    for (const row of stats) expect(Object.values(row).every((v) => v === null), JSON.stringify(row)).toBe(true);
  });
});

describe.skipIf(!hasPyarrow)("pyarrow, an independent reader", () => {
  const inspect = (path: string) => {
    const r = spawnSync("python", [join(__dirname, "../helpers/pq_inspect.py"), path], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout) as { fields: [string, string, boolean][]; num_rows: number; row_groups: number; created_by: string; kv: object; file_kv: object; any_stats: boolean; compression: string[]; first: string[]; nulls: Record<string, number> };
  };

  it("sees the same schema, with nullability", () => {
    const seen = inspect(files.gzip);
    expect(seen.fields).toEqual([
      ["i8", "int8", true], ["i16", "int16", false], ["i32", "int32", true], ["i64", "int64", true],
      ["u8", "uint8", true], ["u16", "uint16", true], ["u32", "uint32", true], ["u64", "uint64", true],
      ["f32", "float", true], ["f64", "double", true],
      ["d9", "decimal128(9, 2)", true], ["d18", "decimal128(18, 4)", true], ["d38", "decimal128(38, 10)", true],
      ["flag", "bool", true], ["name", "string", true], ["day", "date32[day]", true], ["tm", "time64[us]", true],
      ["ts_us", "timestamp[us]", true], ["ts_ms_utc", "timestamp[ms, tz=UTC]", true],
      ["tm_ms", "time32[ms]", true], ["ts_ns", "timestamp[ns]", true],
    ]);
    expect(seen.num_rows).toBe(N);
    expect(seen.row_groups).toBe(3);
  });

  it("reads both codecs, with the footer free of anything from a real file", () => {
    const gz = inspect(files.gzip);
    const plain = inspect(files.none);
    expect(gz.compression).toEqual(["GZIP"]);
    expect(plain.compression).toEqual(["UNCOMPRESSED"]);
    for (const seen of [gz, plain]) {
      expect(seen.created_by).toBe("synthetic-data-generator 0.0.0-test");
      expect(seen.kv).toEqual({});
      expect(seen.file_kv).toEqual({});
      expect(seen.any_stats).toBe(false);
    }
  });

  it("agrees with the engine on the values and the nulls", () => {
    const seen = inspect(files.gzip);
    expect(seen.nulls.i8).toBe(rows.filter((r) => r[0] === null).length);
    expect(seen.nulls.i16).toBe(0);
    expect(seen.nulls.name).toBe(rows.filter((r) => r[14] === null).length);
    expect(seen.first[3]).toBe("9000000000000000000");
    expect(seen.first[7]).toBe("18000000000000000000");
    expect(seen.first[12]).toBe("12345678901234567890.0000000000");
  });
});
