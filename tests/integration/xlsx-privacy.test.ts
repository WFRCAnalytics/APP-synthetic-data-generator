// @vitest-environment node
// Nothing real comes back from a workbook (specs/003 FR-003, FR-019, SC-003). The Excel extension cannot
// load in Node, so this spies on the part that is the same for every source: the table that the sheet is
// converted into. A spy records every row the engine returns while the sheet's table is converted and
// profiled, and fails if any cell value comes back. The browser tests cover the extension itself and
// the other sheets of a workbook.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMPTY_TEXT_TOKEN } from "../../src/lib/spec/types";
import { profileAll } from "../../src/workers/profile/profiler";
import { createSample } from "../../src/workers/profile/stats";
import type { Row, SqlRunner } from "../../src/workers/profile/sql";
import { buildConversionSql } from "../../src/workers/profile/xlsx";
import { createNodeDb, type NodeDb } from "../helpers/duckdbNode";

const MARK = "PRIVATE-MARKER";
let db: NodeDb;

function spy(inner: SqlRunner) {
  const returned: Row[] = [];
  const sql: SqlRunner = {
    async all(query) {
      const rows = await inner.all(query);
      returned.push(...rows);
      return rows;
    },
    run: (query) => inner.run(query),
  };
  return { sql, returned };
}

beforeAll(async () => {
  db = await createNodeDb();
  // What the extension returns for a sheet: typed columns, with text that must never come back.
  await db.sql.run(`CREATE TABLE typed AS
    SELECT
      '${MARK} person ' || i::VARCHAR AS who,
      CASE WHEN i % 11 = 0 THEN '' ELSE '${MARK} comment about the county, number ' || i::VARCHAR || ' with many words in it so it reads as free text' END AS note,
      (i * 12.5)::DOUBLE AS amount,
      DATE '2024-01-01' + (i % 300)::INTEGER AS visited,
      (i % 2 = 0) AS ok,
      lpad(i::VARCHAR, 5, '0') AS code
    FROM range(400) t(i)`);
  const columns = (await db.sql.all("DESCRIBE typed")).map((r) => ({ name: String(r.column_name), type: String(r.column_type) }));
  await db.sql.run(`CREATE OR REPLACE TABLE src AS SELECT ${buildConversionSql(columns)} FROM typed`);
  await createSample(db.sql, 400);
}, 60_000);
afterAll(() => db?.close());

describe("profiling the table made from a sheet", () => {
  it("returns no cell value, however private the text looks", async () => {
    const { sql, returned } = spy(db.sql);
    const profiles = await profileAll(sql, ["who", "note", "amount", "visited", "ok", "code"], 400, { threshold: 50 });
    const cells = [...returned.flatMap((r) => Object.values(r)).filter((v): v is string => typeof v === "string")];
    expect(cells.filter((v) => v.includes(MARK))).toEqual([]);
    expect(cells.filter((v) => /^\d{5}$/.test(v) && Number(v) < 400 && !/^9+$/.test(v))).toEqual([]); // the zero-padded codes
    // And what the profiles hold are summaries.
    expect(JSON.stringify(profiles)).not.toContain(MARK);
    expect(profiles.find((p) => p.name === "who")!.summary.kind).toBe("short_string"); // a made-up pattern, never the text itself
    expect(profiles.find((p) => p.name === "note")!.summary.kind).toBe("free_text");
  });

  it("counts empty text apart from blank cells, as an NA token", async () => {
    const { sql } = spy(db.sql);
    const [note] = await profileAll(sql, ["note"], 400, { threshold: 50 });
    expect(note.naByToken[EMPTY_TEXT_TOKEN]).toBe(37); // every 11th of 400 rows
    expect(note.naTokens).toContain(EMPTY_TEXT_TOKEN);
  });

  it("reads dates as dates and numbers as numbers after conversion", async () => {
    const { sql } = spy(db.sql);
    const profiles = await profileAll(sql, ["amount", "visited", "ok"], 400, { threshold: 50 });
    expect(profiles.map((p) => p.type)).toEqual(["float", "date", "boolean"]);
  });
});
