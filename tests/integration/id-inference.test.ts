// @vitest-environment node
// Survey ID patterns from SQL (FR-014, FR-015, research.md R4). The point of these tests is privacy:
// profiling an ID column may return lengths, character classes, a min and max and a repeat structure,
// but never an ID value. A spy records every row every query returns and checks that no ID is in them.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { maskToRegexString } from "../../src/lib/mask/mask";
import { loadCsv } from "../../src/workers/profile/load";
import { profileColumn } from "../../src/workers/profile/profiler";
import { createSample } from "../../src/workers/profile/stats";
import type { Row, SqlRunner } from "../../src/workers/profile/sql";
import { createNodeDb, openFromDisk, type NodeDb } from "../helpers/duckdbNode";
import { parseCsv } from "../helpers/csvParse";

const ZOO = join(__dirname, "../fixtures/zoo");
let db: NodeDb;

/** Records every statement and every row returned. */
function spy(inner: SqlRunner) {
  const statements: string[] = [];
  const returned: Row[] = [];
  const sql: SqlRunner = {
    async all(query) {
      statements.push(query);
      const rows = await inner.all(query);
      returned.push(...rows);
      return rows;
    },
    async run(query) {
      statements.push(query);
      await inner.run(query);
    },
  };
  return { sql, statements, returned };
}

const stringCells = (rows: Row[]): Set<string> => {
  const out = new Set<string>();
  for (const r of rows) for (const v of Object.values(r)) if (typeof v === "string") out.add(v);
  return out;
};

async function load(file: string) {
  const path = join(ZOO, file);
  const opened = openFromDisk(path);
  db.registerPath(`${file}`, path);
  const loaded = await loadCsv(db.sql, file, opened.settings, opened.columnNames);
  await createSample(db.sql, loaded.rowCount);
  const raw = parseCsv(readFileSync(path, "utf8"));
  return { rowCount: loaded.rowCount, header: raw.rows[0], rows: raw.rows.slice(1) };
}

beforeAll(async () => {
  db = await createNodeDb();
}, 60_000);
afterAll(() => db?.close());

describe("whole-number IDs (50,000 households)", () => {
  it("returns a pattern, a range and a repeat structure, and no ID", async () => {
    const { rowCount, header, rows } = await load("ids_50k.csv");
    const ids = rows.map((r) => r[header.indexOf("hh_id")]);
    const idSet = new Set(ids);
    expect(idSet.size).toBe(50000);

    const { sql, statements, returned } = spy(db.sql);
    const p = await profileColumn(sql, "hh_id", rowCount, { threshold: 50 });

    expect(p.type).toBe("survey_id");
    if (p.summary.kind !== "survey_id") throw new Error("expected an ID summary");
    expect(maskToRegexString(p.summary.mask)).toBe("[0-9]{5}");
    expect(p.summary.min).toBe(10000);
    expect(p.summary.max).toBe(59999);
    expect(p.summary.distinct).toBe(50000);

    // The repeat structure equals the one computed straight from the file.
    const perId = new Map<string, number>();
    for (const id of ids) perId.set(id, (perId.get(id) ?? 0) + 1);
    const want: Record<string, number> = {};
    for (const n of perId.values()) want[n] = (want[n] ?? 0) + 1;
    expect(p.summary.repeatStructure).toEqual(want);

    // No query returned an ID as text, and the frequent-value query never ran for this column.
    expect([...stringCells(returned)].filter((v) => idSet.has(v))).toEqual([]);
    expect(statements.some((s) => /LIMIT 60\b/.test(s))).toBe(false);
  });

  it("keeps leading zeros as padding", async () => {
    const { rowCount } = await load("ids_50k.csv");
    const p = await profileColumn(db.sql, "person_id", rowCount, { threshold: 50 });
    expect(p.type).toBe("survey_id");
    if (p.summary.kind !== "survey_id") throw new Error("expected an ID summary");
    expect(maskToRegexString(p.summary.mask)).toBe("[0-9]{2}");
    expect(p.summary.padWidth).toBe(2);
    expect(p.summary.min).toBe(1);
    expect(p.summary.max).toBe(4);
  });
});

describe("IDs with letters and separators", () => {
  it("returns only the constant characters of a pattern, never a whole ID", async () => {
    const { rowCount, header, rows } = await load("zoo_small.csv");
    const siteIds = new Set(rows.map((r) => r[header.indexOf("site_id")]));
    const prefixIds = new Set(rows.map((r) => r[header.indexOf("hh_prefix_id")]));

    const { sql, returned } = spy(db.sql);
    const site = await profileColumn(sql, "site_id", rowCount, { threshold: 50 });
    const prefix = await profileColumn(sql, "hh_prefix_id", rowCount, { threshold: 50 });

    if (site.summary.kind !== "survey_id" || prefix.summary.kind !== "survey_id") throw new Error("expected ID summaries");
    expect(maskToRegexString(site.summary.mask)).toBe("UT-[0-9]{3}-[0-9]{3}");
    expect(maskToRegexString(prefix.summary.mask)).toBe("HH[0-9]{7}");

    const cells = stringCells(returned);
    expect([...cells].filter((v) => siteIds.has(v) || prefixIds.has(v))).toEqual([]);
    // Long strings that came back are character-class shapes (A for a letter, 9 for a digit), not IDs.
    expect([...cells].filter((v) => v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v) && !/^[A9\-_. ]+$/.test(v))).toEqual([]);
  });

  it("does not hand the frequent or unparsed values of an ID column to memory", async () => {
    const { rowCount } = await load("zoo_small.csv");
    const { sql, statements } = spy(db.sql);
    await profileColumn(sql, "site_id", rowCount, { threshold: 50 });
    expect(statements.some((s) => /LIMIT 60\b/.test(s))).toBe(false); // frequent values
    expect(statements.some((s) => /LIMIT 6\b/.test(s))).toBe(false); // unparsed values
  });

  it("falls back to a general pattern when IDs have different lengths", async () => {
    const { rowCount } = await load("zoo_small.csv");
    const p = await profileColumn(db.sql, "mixed_mask_id", rowCount, { threshold: 50 });
    if (p.summary.kind !== "survey_id") throw new Error("expected an ID summary");
    expect(p.summary.mask).toEqual(["alnum", "alnum", "alnum", "alnum", "alnum"]);
    expect(p.attentionReasons).toContain("id_mixed_masks");
    expect(p.status).toBe("needs_attention");
    expect(p.exclude).toBe("include");
  });

  it("reports the repeat structure of IDs that repeat in groups", async () => {
    const { rowCount, header, rows } = await load("zoo_small.csv");
    const p = await profileColumn(db.sql, "hh_id", rowCount, { threshold: 50 });
    if (p.summary.kind !== "survey_id") throw new Error("expected an ID summary");
    const perId = new Map<string, number>();
    for (const r of rows) perId.set(r[header.indexOf("hh_id")], (perId.get(r[header.indexOf("hh_id")]) ?? 0) + 1);
    const want: Record<string, number> = {};
    for (const n of perId.values()) want[n] = (want[n] ?? 0) + 1;
    expect(p.summary.repeatStructure).toEqual(want);
    expect(Object.keys(want).length).toBeGreaterThan(1); // grouped, not unique per row
  });

  it("reports a unique-per-row column as all ones", async () => {
    const { rowCount } = await load("zoo_small.csv");
    const p = await profileColumn(db.sql, "row_id", rowCount, { threshold: 50 });
    if (p.summary.kind !== "survey_id") throw new Error("expected an ID summary");
    expect(p.summary.repeatStructure).toEqual({ "1": 2000 });
  });
});

describe("IDs and missing values", () => {
  it("leaves NA rows out of the repeat structure and the range", async () => {
    const csv = ["hh_id", "10", "10", "NA", "20", "", "30", "30", "30", ""].join("\n");
    const small = await createNodeDb();
    try {
      small.registerBuffer("ids.csv", new TextEncoder().encode(csv));
      const loaded = await loadCsv(small.sql, "ids.csv", openFromDisk(join(ZOO, "zoo_small.csv")).settings, ["hh_id"]);
      await createSample(small.sql, loaded.rowCount);
      const p = await profileColumn(small.sql, "hh_id", loaded.rowCount, { threshold: 50 });
      if (p.summary.kind !== "survey_id") throw new Error("expected an ID summary");
      expect(p.summary.repeatStructure).toEqual({ "1": 1, "2": 1, "3": 1 });
      expect(p.summary.min).toBe(10);
      expect(p.summary.max).toBe(30);
      expect(p.naCount).toBe(2); // "NA" and one blank row (the file's last blank line is not a row)
    } finally {
      small.close();
    }
  });
});
