// @vitest-environment node
// Profiling personal, free text and short string columns returns only aggregates (specs/002 FR-008,
// SC-002, research R6, R12). A spy records every statement and every row the data engine returns
// while these columns are profiled, then checks that no real value of them came back, and that the
// frequent-value query ran only where it is needed.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCsv } from "../../src/workers/profile/load";
import { profileColumn } from "../../src/workers/profile/profiler";
import { createSample } from "../../src/workers/profile/stats";
import type { Row, SqlRunner } from "../../src/workers/profile/sql";
import { createNodeDb, openFromDisk, type NodeDb } from "../helpers/duckdbNode";
import { parseCsv } from "../helpers/csvParse";

const ZOO = join(__dirname, "../fixtures/zoo");
let db: NodeDb;
let rowCount = 0;
let header: string[] = [];
let rows: string[][] = [];

/** Records every statement and every row returned. */
function spy(inner: SqlRunner) {
  const statements: string[] = [];
  const returned: Row[] = [];
  const sql: SqlRunner = {
    async all(query) {
      statements.push(query);
      const result = await inner.all(query);
      returned.push(...result);
      return result;
    },
    async run(query) {
      statements.push(query);
      await inner.run(query);
    },
  };
  return { sql, statements, returned };
}

const stringCells = (list: Row[]): Set<string> => {
  const out = new Set<string>();
  for (const r of list) for (const v of Object.values(r)) if (typeof v === "string") out.add(v);
  return out;
};

beforeAll(async () => {
  db = await createNodeDb();
  const path = join(ZOO, "zoo_small.csv");
  const opened = openFromDisk(path);
  db.registerPath("zoo.csv", path);
  const loaded = await loadCsv(db.sql, "zoo.csv", opened.settings, opened.columnNames);
  await createSample(db.sql, loaded.rowCount);
  rowCount = loaded.rowCount;
  const raw = parseCsv(readFileSync(path, "utf8"));
  header = raw.rows[0];
  rows = raw.rows.slice(1);
}, 60_000);
afterAll(() => db?.close());

const column = (name: string) => rows.map((r) => r[header.indexOf(name)]);

const TEXT_COLUMNS = ["email", "phone_us", "person_name", "first_name", "last_name", "street_address", "url", "ip_address", "ssn_like", "free_text", "comments", "plate", "vendor_code", "short_code_many", "uuid", "zip_text", "email_mixed"];

describe("no real value of a text column is returned by the data engine", () => {
  it.each(TEXT_COLUMNS)("%s", async (name) => {
    const real = new Set(column(name).filter((v) => v !== ""));
    const { sql, returned } = spy(db.sql);
    await profileColumn(sql, name, rowCount, { threshold: 50 });
    // Anything the engine returned that equals a real value of the column is a leak. Shapes (A and 9)
    // and single punctuation characters are not values.
    // A shape made only of 9s (for a column of digits) can equal a real value by coincidence.
    const leaked = [...stringCells(returned)].filter((v) => real.has(v) && v.length > 1 && !/^[9AUL\W_]+$/.test(v));
    expect(leaked, name).toEqual([]);
  });

  it("nothing returned for a free text column is as long as a real value", async () => {
    const { sql, returned } = spy(db.sql);
    await profileColumn(sql, "comments", rowCount, { threshold: 50 });
    const longest = Math.max(...column("comments").filter((v) => v !== "").map((v) => v.length));
    for (const v of stringCells(returned)) expect(v.length).toBeLessThan(longest);
  });
});

describe("the frequent-value query", () => {
  const frequent = (statements: string[]) => statements.some((s) => /ORDER BY n DESC, v LIMIT 60\b/.test(s));

  it.each(["email", "person_name", "street_address", "free_text", "comments", "plate", "uuid", "url"])("does not run for %s", async (name) => {
    const { sql, statements } = spy(db.sql);
    await profileColumn(sql, name, rowCount, { threshold: 50 });
    expect(frequent(statements), name).toBe(false);
  });

  it("still runs for a numeric column with sentinel codes (slice 1 behavior is kept)", async () => {
    const { sql, statements } = spy(db.sql);
    const p = await profileColumn(sql, "int_sentinels", rowCount, { threshold: 50 });
    expect(frequent(statements)).toBe(true);
    expect(Object.keys(p.sentinels).length).toBeGreaterThan(0);
  });

  it("still runs for a categorical column, so its labels can be listed", async () => {
    const { sql, statements } = spy(db.sql);
    await profileColumn(sql, "cat_str_5", rowCount, { threshold: 50 });
    expect(frequent(statements)).toBe(true);
  });

  it("still runs for a date column written with digits", async () => {
    const { sql, statements } = spy(db.sql);
    await profileColumn(sql, "date_iso", rowCount, { threshold: 50 });
    expect(frequent(statements)).toBe(true);
  });
});
