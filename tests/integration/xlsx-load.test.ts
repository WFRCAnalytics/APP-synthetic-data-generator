// @vitest-environment node
// Loading a worksheet into the all-text table (specs/003 FR-005, FR-007, FR-008, research R3, R4). The
// Excel extension cannot be loaded in Node, so the conversion to text is tested here on a synthetic typed
// table (what the extension returns), and the real `read_xlsx` path in the browser tests. The load must
// never return a row to the page: only column names, types and a count.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMPTY_TEXT_TOKEN } from "../../src/lib/spec/types";
import type { Row, SqlRunner } from "../../src/workers/profile/sql";
import { buildConversionSql, buildReadSql, loadSheet } from "../../src/workers/profile/xlsx";
import { createNodeDb, type NodeDb } from "../helpers/duckdbNode";

let db: NodeDb;
beforeAll(async () => {
  db = await createNodeDb();
}, 60_000);
afterAll(() => db?.close());

describe("buildReadSql", () => {
  it("reads one sheet with its header and range", () => {
    expect(buildReadSql("book.xlsx", { sheet: "Survey Data", range: "A3:I203", header: true })).toBe("read_xlsx('book.xlsx', sheet = 'Survey Data', range = 'A3:I203', header = true)");
  });

  it("leaves the range out when there is none, and quotes what needs it", () => {
    expect(buildReadSql("o'brien.xlsx", { sheet: "It's", header: false })).toBe("read_xlsx('o''brien.xlsx', sheet = 'It''s', header = false)");
  });
});

describe("the conversion to text", () => {
  const types = [
    ["d", "DATE"],
    ["ts", "TIMESTAMP"],
    ["tm", "TIME"],
    ["whole", "DOUBLE"],
    ["frac", "DOUBLE"],
    ["neg", "DOUBLE"],
    ["tiny", "DOUBLE"],
    ["b", "BOOLEAN"],
    ["s", "VARCHAR"],
    ["i", "BIGINT"],
  ].map(([name, type]) => ({ name, type }));

  async function converted() {
    await db.sql.run("DROP TABLE IF EXISTS typed");
    await db.sql.run(`CREATE TABLE typed AS SELECT * FROM (VALUES
      (DATE '2024-01-05', TIMESTAMP '2024-01-05 08:30:15', TIME '08:30:00', 1000::DOUBLE, 1012.5::DOUBLE, -9::DOUBLE, 0.00001::DOUBLE, TRUE, 'abc', 7::BIGINT),
      (NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
      (DATE '1999-12-31', TIMESTAMP '1999-12-31 23:59:59', TIME '00:00:01', 0::DOUBLE, 0.1::DOUBLE, -0.5::DOUBLE, 123456789012::DOUBLE, FALSE, '', 0::BIGINT)
    ) t(d, ts, tm, whole, frac, neg, tiny, b, s, i)`);
    await db.sql.run("DROP TABLE IF EXISTS converted");
    await db.sql.run(`CREATE TABLE converted AS SELECT ${buildConversionSql(types)} FROM typed`);
    return (await db.sql.all("SELECT * FROM converted")) as Row[];
  }

  it("writes dates, times and date-times as ISO text", async () => {
    const [a, , c] = await converted();
    expect([a.d, a.ts, a.tm]).toEqual(["2024-01-05", "2024-01-05 08:30:15", "08:30:00"]);
    expect([c.d, c.ts, c.tm]).toEqual(["1999-12-31", "1999-12-31 23:59:59", "00:00:01"]);
  });

  it("writes whole numbers without a trailing .0, and other numbers as they are", async () => {
    const [a, , c] = await converted();
    expect([a.whole, a.frac, a.neg]).toEqual(["1000", "1012.5", "-9"]);
    expect([c.whole, c.frac, c.neg]).toEqual(["0", "0.1", "-0.5"]);
    expect(a.tiny).toMatch(/^1e-0?5$/i);
    expect(c.tiny).toBe("123456789012");
    expect(a.i).toBe("7");
  });

  it("writes booleans as TRUE and FALSE", async () => {
    const [a, , c] = await converted();
    expect([a.b, c.b]).toEqual(["TRUE", "FALSE"]);
  });

  it("turns empty text into the empty-text token and keeps a blank cell as NULL", async () => {
    const [a, b, c] = await converted();
    expect(c.s).toBe(EMPTY_TEXT_TOKEN);
    expect(a.s).toBe("abc");
    for (const column of types) expect(b[column.name], column.name).toBeNull();
  });

  it("keeps every column name, in order, with quotes and spaces", () => {
    const sql = buildConversionSql([{ name: 'a "b"', type: "VARCHAR" }, { name: "c d", type: "DOUBLE" }]);
    expect(sql).toContain('"a ""b"""');
    expect(sql.indexOf('"a ""b"""')).toBeLessThan(sql.indexOf('"c d"'));
  });

  it("converts a type it does not know by casting it", () => {
    expect(buildConversionSql([{ name: "x", type: "HUGEINT" }])).toContain('CAST("x" AS VARCHAR)');
  });
});

describe("loadSheet", () => {
  /** A runner that records every statement and answers the questions the loader asks, with no data. */
  function recorder() {
    const statements: { kind: "all" | "run"; sql: string }[] = [];
    const sql: SqlRunner = {
      async all(query) {
        statements.push({ kind: "all", sql: query });
        if (query.startsWith("DESCRIBE")) return [{ column_name: "a", column_type: "VARCHAR" }, { column_name: "b", column_type: "DOUBLE" }];
        if (query.includes("count(*)")) return [{ n: 7 }];
        return [];
      },
      async run(query) {
        statements.push({ kind: "run", sql: query });
      },
    };
    return { sql, statements };
  }

  it("describes the sheet, creates the table and counts the rows: no statement returns data", async () => {
    const { sql, statements } = recorder();
    const result = await loadSheet(sql, "book.xlsx", { sheet: "Data", range: "A1:B8", header: true });
    expect(result).toEqual({ rowCount: 7, columnNames: ["a", "b"], columnTypes: ["VARCHAR", "DOUBLE"] });
    expect(statements.map((s) => s.kind)).toEqual(["all", "run", "all"]);
    expect(statements[0].sql).toMatch(/^DESCRIBE SELECT \* FROM read_xlsx\('book\.xlsx'/);
    expect(statements[1].sql).toMatch(/^CREATE OR REPLACE TABLE src AS SELECT .* FROM read_xlsx\('book\.xlsx', sheet = 'Data', range = 'A1:B8', header = true\)/);
    expect(statements[2].sql).toBe("SELECT count(*) AS n FROM src");
    // Nothing selects the cells themselves back to the page.
    expect(statements.filter((s) => s.kind === "all" && /SELECT \* FROM (src|read_xlsx)/.test(s.sql) && !s.sql.startsWith("DESCRIBE"))).toEqual([]);
  });

  it("turns an engine failure into a fixed message that holds no cell value", async () => {
    const sql: SqlRunner = {
      async all() {
        return [{ column_name: "a", column_type: "VARCHAR" }];
      },
      async run() {
        throw new Error("Conversion Error: Could not convert string 'Jane Doe' to DOUBLE in column 'a' at row 12");
      },
    };
    const error = await loadSheet(sql, "book.xlsx", { sheet: "Data", header: true }).catch((e) => e);
    expect(String(error.message)).not.toMatch(/Jane|Doe/);
  });

  it("refuses a sheet with no columns", async () => {
    const sql: SqlRunner = { all: async () => [], run: async () => {} };
    const error = await loadSheet(sql, "book.xlsx", { sheet: "Empty", header: true }).catch((e) => e);
    expect(error.code).toBe("file_empty");
  });
});
