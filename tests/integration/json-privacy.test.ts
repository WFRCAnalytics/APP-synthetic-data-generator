// @vitest-environment node
// Nothing real comes back from a JSON file except its structure (specs/007 FR-003, FR-010, FR-016, SC-002, research
// R2). A file whose values, nested values and nested key names all hold marker strings is inspected, loaded and
// profiled through a spy that records every query and every row the engine returns to the caller. No marker may
// come back, and the structure queries never ask for the keys of a nested value.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectJson } from "../../src/lib/json/detect";
import { columnSpecOf } from "../../src/lib/spec/build";
import { profileAll } from "../../src/workers/profile/profiler";
import { inspectJson, loadJson } from "../../src/workers/profile/json";
import type { Row, SqlRunner } from "../../src/workers/profile/sql";
import { createSample } from "../../src/workers/profile/stats";
import { createNodeDb, type NodeDb } from "../helpers/duckdbNode";

const MARK = "PRIVATE-MARKER";
const NESTED = "NESTED-MARKER";

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

const everyString = (rows: Row[]) => rows.flatMap((r) => Object.values(r)).filter((v): v is string => typeof v === "string");

beforeAll(async () => {
  db = await createNodeDb();
  await db.sql.run("LOAD json");
  db.registerBuffer("markers.json", new Uint8Array(readFileSync(join(process.cwd(), "tests/fixtures/json/markers.json"))));
}, 60_000);
afterAll(() => db?.close());

const layoutOf = () => {
  const bytes = new Uint8Array(readFileSync(join(process.cwd(), "tests/fixtures/json/markers.json")));
  return detectJson(bytes.subarray(0, 65536), bytes.subarray(Math.max(0, bytes.length - 4096))).layout;
};

describe("the fixture really carries markers where a leak could come from", () => {
  it("has them in values, nested values and nested key names", async () => {
    const rows = await db.sql.all("SELECT json::VARCHAR AS j FROM read_json_objects('markers.json', format = 'array') LIMIT 1");
    const text = String(rows[0].j);
    expect(text).toContain(MARK);
    expect(text).toContain(NESTED);
  });
});

describe("inspecting, loading and profiling", () => {
  it("returns no marker, however private the text looks", async () => {
    const { sql, returned } = spy(db.sql);
    const info = await inspectJson(sql, "markers.json", layoutOf(), 1000);
    expect(JSON.stringify(info)).not.toContain(MARK);
    expect(JSON.stringify(info)).not.toContain(NESTED);
    const loaded = await loadJson(sql, "markers.json", info);
    await createSample(sql, loaded.rowCount);
    const profiles = await profileAll(sql, loaded.columnNames, loaded.rowCount, { threshold: 50 });
    const text = [...everyString(returned), JSON.stringify(profiles)].join("\n");
    expect(text).not.toContain(MARK);
    expect(text).not.toContain(NESTED);
    expect(loaded.columnNames).toEqual(["n", "amount", "note", "who", "inner", "list"]);
  });

  it("never asks for the keys of a nested value, nor for a value before the load", async () => {
    const { sql, queries } = spy(db.sql);
    await inspectJson(sql, "markers.json", layoutOf(), 1000);
    for (const q of queries) {
      expect(q).not.toMatch(/json_extract_string/);
      expect(q).not.toMatch(/json_keys\(json_extract|json_keys\(json, /);
    }
  });

  it("puts a spec together that holds no marker, no nested key name and no value", async () => {
    const { sql } = spy(db.sql);
    const info = await inspectJson(sql, "markers.json", layoutOf(), 1000);
    const loaded = await loadJson(sql, "markers.json", info);
    await createSample(sql, loaded.rowCount);
    // As the worker does: the nested keys are locked to unsupported, whatever else is asked.
    const locks = Object.fromEntries(info.keys.filter((k) => k.unsupported).map((k) => [k.name, { type: "unsupported" as const }]));
    const profiles = await profileAll(sql, loaded.columnNames, loaded.rowCount, { threshold: 50 }, undefined, undefined, locks);
    const columns = profiles.map((p, i) => {
      const key = info.keys[i];
      return columnSpecOf({ ...p, jsonKind: key.kind, jsonMissing: key.missing });
    });
    const text = JSON.stringify(columns);
    expect(text).not.toContain(MARK);
    expect(text).not.toContain(NESTED);
    expect(columns.find((c) => c.name === "inner")).toMatchObject({ type: "unsupported", json_kind: "object" });
    expect(Object.keys(columns.find((c) => c.name === "list")!).sort()).toEqual(["exclude", "json_kind", "json_missing", "name", "type"].sort());
  });
});

describe("a damaged file", () => {
  it("gives a fixed message that holds nothing from the file", async () => {
    db.registerBuffer("bad.json", new TextEncoder().encode('[{"id": "SECRET-BAD", "x": }]'));
    let message = "";
    try {
      await inspectJson(db.sql, "bad.json", { form: "array", indent: "compact", lineEnding: "lf", trailingNewline: false, bom: false }, 30);
    } catch (e) {
      message = String((e as Error).message);
    }
    expect(message).toMatch(/not plain JSON/);
    expect(message).not.toMatch(/SECRET|bad\.json|byte/);
  });
});
