// @vitest-environment node
// Nothing real comes back from a Parquet file except its structure (specs/005 FR-003, FR-009, FR-017, SC-002,
// research R2). A file whose data, key-value notes, creator text and row-group statistics all hold marker
// strings is inspected, loaded and profiled through a spy that records every query and every row the engine
// returns. No marker may come back, and no query may ask for a part of the footer that can hold a value.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { profileAll } from "../../src/workers/profile/profiler";
import { inspectParquet, loadParquet } from "../../src/workers/profile/parquet";
import type { Row, SqlRunner } from "../../src/workers/profile/sql";
import { createSample } from "../../src/workers/profile/stats";
import { createNodeDb, type NodeDb } from "../helpers/duckdbNode";

const MARK = "PRIVATE-MARKER";
/** Things that sit in the file's footer or metadata and must never be returned. */
const FOOTER_TEXT = [MARK, "pandas metadata", "key value metadata", "parquet-cpp", "pyarrow", "free text note number"];
/** Parts of the footer that can hold a real value: asking for them is itself a leak. */
const FORBIDDEN_QUERY = /created_by|stats_|min_value|max_value|parquet_kv_metadata|key_value_metadata|bloom_filter|dictionary|statistics/i;
/** A query that reads the file itself (its footer functions or its data), as opposed to the loaded table. */
const TOUCHES_FILE = /parquet_(schema|metadata|file_metadata|kv_metadata)|read_parquet/i;

let db: NodeDb;

function spy(inner: SqlRunner) {
  const queries: string[] = [];
  const returned: Row[] = [];
  const sql: SqlRunner = {
    async all(query) {
      queries.push(query);
      const rows = await inner.all(query);
      returned.push(...rows);
      return rows;
    },
    run: (query) => {
      queries.push(query);
      return inner.run(query);
    },
  };
  return { sql, queries, returned };
}

const strings = (rows: Row[]) => rows.flatMap((r) => Object.values(r)).filter((v): v is string => typeof v === "string");

beforeAll(async () => {
  db = await createNodeDb();
  await db.sql.run("LOAD parquet");
  db.registerBuffer("markers.parquet", new Uint8Array(readFileSync(join(process.cwd(), "tests/fixtures/parquet/markers.parquet"))));
}, 60_000);
afterAll(() => db?.close());

describe("the fixture really carries markers where a leak could come from", () => {
  it("has them in the data, the key-value notes and the creator text", async () => {
    const kv = await db.sql.all("SELECT CAST(key AS VARCHAR) AS key, CAST(value AS VARCHAR) AS value FROM parquet_kv_metadata('markers.parquet')");
    expect(JSON.stringify(kv)).toContain(MARK);
    const meta = await db.sql.all("SELECT created_by FROM parquet_file_metadata('markers.parquet')");
    expect(String(meta[0].created_by)).toMatch(/parquet-cpp/);
    const stats = await db.sql.all("SELECT CAST(stats_min_value AS VARCHAR) AS lo, CAST(stats_max_value AS VARCHAR) AS hi FROM parquet_metadata('markers.parquet') WHERE path_in_schema = 'who'");
    expect(JSON.stringify(stats)).toContain(MARK);
  });
});

describe("inspecting, loading and profiling", () => {
  it("returns no marker, however private the text looks", async () => {
    const { sql, returned } = spy(db.sql);
    const info = await inspectParquet(sql, "markers.parquet");
    const loaded = await loadParquet(sql, "markers.parquet", info);
    await createSample(sql, loaded.rowCount);
    const profiles = await profileAll(sql, loaded.columnNames, loaded.rowCount, { threshold: 50 });

    const cells = strings(returned);
    for (const text of FOOTER_TEXT) expect(cells.filter((v) => v.includes(text)), text).toEqual([]);
    expect(JSON.stringify(info)).not.toMatch(new RegExp(FOOTER_TEXT.join("|"), "i"));
    expect(JSON.stringify(profiles)).not.toMatch(new RegExp(FOOTER_TEXT.join("|"), "i"));
    expect(profiles.find((p) => p.name === "note")!.summary.kind).toBe("free_text");
  });

  it("never asks for the creator, the key-value notes, a statistic, a bloom filter or a dictionary", async () => {
    const { sql, queries } = spy(db.sql);
    const info = await inspectParquet(sql, "markers.parquet");
    const loaded = await loadParquet(sql, "markers.parquet", info);
    await createSample(sql, loaded.rowCount);
    await profileAll(sql, loaded.columnNames, loaded.rowCount, { threshold: 50 });
    expect(queries.length).toBeGreaterThan(5);
    const onFile = queries.filter((q) => TOUCHES_FILE.test(q));
    expect(onFile.length).toBeGreaterThanOrEqual(5); // the footer functions, DESCRIBE and the load
    expect(onFile.filter((q) => FORBIDDEN_QUERY.test(q))).toEqual([]);
    // and what profiling asks of the loaded table never names the file at all
    expect(queries.filter((q) => !TOUCHES_FILE.test(q) && /parquet/i.test(q))).toEqual([]);
  });

  it("asks the file only for structure: a fixed list of footer functions and columns", async () => {
    const { sql, queries } = spy(db.sql);
    await inspectParquet(sql, "markers.parquet");
    const footer = queries.filter((q) => /parquet_(schema|metadata|file_metadata)/.test(q));
    expect(footer).toHaveLength(3);
    expect(footer.some((q) => /parquet_schema/.test(q) && /name, type, converted_type, logical_type, type_length, scale, "precision", repetition_type, num_children/.test(q))).toBe(true);
    expect(footer.some((q) => /parquet_file_metadata/.test(q) && /num_rows, num_row_groups/.test(q))).toBe(true);
    expect(footer.some((q) => /parquet_metadata/.test(q) && /total_uncompressed_size/.test(q))).toBe(true);
  });

  it("returns only numbers, names and fixed type words from the footer", async () => {
    const { sql, returned } = spy(db.sql);
    await inspectParquet(sql, "markers.parquet");
    const words = strings(returned);
    // column names and engine type words; nothing of the file's own text
    expect(new Set(words.filter((w) => !["who", "score", "note", "schema"].includes(w)))).toEqual(
      new Set(words.filter((w) => /^(VARCHAR|INTEGER|BYTE_ARRAY|INT32|UTF8|StringType\(\)|OPTIONAL|REQUIRED|REPEATED|null|YES|NO)$/.test(w))),
    );
  });
});
