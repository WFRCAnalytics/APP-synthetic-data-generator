// @vitest-environment node
// Loading JSON files the way the profile worker does (specs/007 FR-001 to FR-004, FR-007 to FR-009, FR-013, FR-014,
// research R2, R3): structure from the file, the all-text table that profiling reads, nested keys that are never
// read, and the files that are refused. The JSON reader cannot be fetched in Node but is linked in, so this runs
// the real loader against the real fixtures.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "../../src/lib/errors";
import { detectJson, HEAD_BYTES, TAIL_BYTES } from "../../src/lib/json/detect";
import { EMPTY_TEXT_TOKEN } from "../../src/lib/spec/types";
import { inspectJson, loadJson, type JsonInfo } from "../../src/workers/profile/json";
import { createNodeDb, type NodeDb } from "../helpers/duckdbNode";

const dir = join(process.cwd(), "tests/fixtures/json");
let db: NodeDb;

const bytesOf = (name: string): Uint8Array => new Uint8Array(readFileSync(join(dir, name)));

function register(name: string, bytes: Uint8Array = bytesOf(name)) {
  db.registerBuffer(name, bytes);
  const head = bytes.subarray(0, HEAD_BYTES);
  const tail = bytes.subarray(Math.max(0, bytes.length - TAIL_BYTES));
  return { layout: detectJson(head, tail), size: bytes.length };
}

async function inspect(name: string, bytes?: Uint8Array): Promise<JsonInfo> {
  const { layout, size } = register(name, bytes);
  return inspectJson(db.sql, name, layout.layout, size);
}

const fails = async (p: Promise<unknown>): Promise<AppError> => {
  try {
    await p;
  } catch (e) {
    return e as AppError;
  }
  throw new Error("expected a failure");
};

beforeAll(async () => {
  db = await createNodeDb();
  await db.sql.run("LOAD json");
}, 60_000);
afterAll(() => db?.close());

describe("structure of an array", () => {
  it("reads the record count, the keys in first-seen order and their kinds, without a value", async () => {
    const info = await inspect("survey.json");
    expect(info.rowCount).toBe(400);
    expect(info.layout.form).toBe("array");
    expect(info.keys.map((k) => [k.name, k.kind])).toEqual([
      ["hh_id", "string"],
      ["person_no", "number"],
      ["age", "number"],
      ["income", "number"],
      ["mode", "string"],
      ["has_pass", "boolean"],
      ["trip_date", "string"],
      ["name", "string"],
    ]);
    // Only structure comes back: no key of the result holds record text.
    expect(JSON.stringify(info)).not.toContain("PRIVATE-MARKER");
    expect(JSON.stringify(info)).not.toContain("HH-1000");
  });

  it("builds the all-text table that profiling reads", async () => {
    const info = await inspect("survey.json");
    const loaded = await loadJson(db.sql, "survey.json", info);
    expect(loaded.rowCount).toBe(400);
    expect(loaded.columnNames).toEqual(info.keys.map((k) => k.name));
    const [row] = await db.sql.all("SELECT hh_id, person_no, age, has_pass, name FROM src LIMIT 1");
    expect(row.hh_id).toBe("HH-1000");
    expect(row.person_no).toBe("1");
    expect(row.has_pass).toBe("TRUE");
    expect(String(row.name)).toContain("PRIVATE-MARKER");
    const [types] = await db.sql.all("SELECT typeof(age) AS t FROM src LIMIT 1");
    expect(types.t).toBe("VARCHAR");
  });
});

describe("structure of one record per line", () => {
  it.each(["survey.ndjson", "survey.jsonl"])("reads %s by its content", async (name) => {
    const info = await inspect(name);
    expect(info.layout.form).toBe("lines");
    expect(info.keys.map((k) => k.name)).toEqual(["hh_id", "person_no", "age", "income", "mode", "has_pass", "trip_date", "name"]);
    expect(info.rowCount).toBe(name === "survey.ndjson" ? 400 : 50);
  });

  it("reads a file with CRLF and a byte-order mark, and records both", async () => {
    const info = await inspect("survey_crlf_bom.json");
    expect(info.layout.bom).toBe(true);
    expect(info.layout.lineEnding).toBe("crlf");
    expect(info.rowCount).toBe(60);
  });

  it("reads each indent and records it", async () => {
    for (const [name, indent] of [["pretty2.json", "2"], ["pretty4.json", "4"], ["tab.json", "tab"], ["compact.json", "compact"]] as const) {
      const { layout } = register(name);
      expect(layout.layout.indent).toBe(indent);
    }
  });
});

describe("null, missing and mixed keys", () => {
  it("counts nulls and absent keys apart", async () => {
    const info = await inspect("nulls_missing.json");
    const by = Object.fromEntries(info.keys.map((k) => [k.name, k]));
    expect(info.rowCount).toBe(300);
    expect(by.score).toMatchObject({ kind: "number", nulls: 60, missing: 0 });
    // nick: absent every 7th record (43), null every 11th that is not also a 7th.
    expect(by.nick.missing).toBe(43);
    expect(by.nick.nulls).toBe(24);
    expect(by.extra).toMatchObject({ kind: "number", missing: 200, nulls: 0 });
    expect(info.keys.map((k) => k.name)).toEqual(["id", "score", "extra", "nick"]); // the first record lacks nick
  });

  it("loads both nulls and absent keys as NULL in the table", async () => {
    const info = await inspect("nulls_missing.json");
    await loadJson(db.sql, "nulls_missing.json", info);
    const [r] = await db.sql.all("SELECT count(*) FILTER (WHERE nick IS NULL) AS nulls FROM src");
    expect(r.nulls).toBe(67);
  });

  it("reads a key of numbers and text as text, with the mixed flag", async () => {
    const info = await inspect("mixed.json");
    const code = info.keys.find((k) => k.name === "code")!;
    expect(code).toMatchObject({ kind: "string", mixed: true });
    await loadJson(db.sql, "mixed.json", info);
    const [r] = await db.sql.all("SELECT code FROM src LIMIT 2");
    expect(r.code).toBe("PRIVATE-MARKER-0");
  });

  it("writes a number as the engine renders it, with a whole double read as a whole number", async () => {
    const info = await inspect("numbers.json");
    await loadJson(db.sql, "numbers.json", info);
    const rows = await db.sql.all("SELECT a, b, c, d, e FROM src");
    expect(rows[0]).toMatchObject({ a: "1.5", b: "100000", c: "12345678901234567890", d: "-0.25", e: "7" });
    expect(rows[1]).toMatchObject({ a: "2.25", b: "0.0025", c: "1", d: "3", e: "8" });
  });

  it("keeps an empty string apart from a missing value", async () => {
    const bytes = new TextEncoder().encode('[{"a": ""}, {"a": null}, {"a": "x"}, {}]');
    const info = await inspect("empties.json", bytes);
    await loadJson(db.sql, "empties.json", info);
    const rows = await db.sql.all("SELECT a FROM src");
    expect(rows.map((r) => r.a)).toEqual([EMPTY_TEXT_TOKEN, null, "x", null]);
    expect(info.keys[0]).toMatchObject({ nulls: 1, missing: 1 });
  });
});

describe("nested keys", () => {
  it("marks an object key and a list key unsupported and never reads them", async () => {
    const info = await inspect("nested.json");
    const by = Object.fromEntries(info.keys.map((k) => [k.name, k]));
    expect(by.detail).toMatchObject({ kind: "object", unsupported: "nested_object" });
    expect(by.tags).toMatchObject({ kind: "array", unsupported: "nested_array" });
    expect(info.keys.map((k) => k.name)).toEqual(["id", "label", "detail", "tags"]);
    expect(JSON.stringify(info)).not.toContain("NESTED-MARKER");
    await loadJson(db.sql, "nested.json", info);
    const [r] = await db.sql.all("SELECT count(detail) AS d, count(tags) AS t, count(label) AS l FROM src");
    expect(r).toMatchObject({ d: 0, t: 0, l: 80 });
  });
});

describe("keys with unusual names", () => {
  it("addresses each key exactly, including quotes, slashes, tildes, dots, spaces and an empty key", async () => {
    const keys = ['a"b', "a/b", "a~b", "a.b", "a b", "", "é😀", "$x", "[0]"];
    const record = Object.fromEntries(keys.map((k, i) => [k, `v${i}`]));
    const bytes = new TextEncoder().encode(JSON.stringify([record, record]));
    const info = await inspect("weird.json", bytes);
    expect(info.keys.map((k) => k.key)).toEqual(keys);
    expect(info.keys.find((k) => k.key === "")?.renamed).toBe(true);
    await loadJson(db.sql, "weird.json", info);
    const [row] = await db.sql.all("SELECT * FROM src LIMIT 1");
    expect(Object.values(row)).toEqual(keys.map((_, i) => `v${i}`));
  });
});

describe("files that are refused", () => {
  it.each([
    ["damaged.json", "json_malformed"],
    ["items.json", "json_not_records"],
    ["dup.json", "json_duplicate_key"],
    ["empty.json", "json_empty"],
    ["comments.json", "json_malformed"],
  ])("refuses %s with a fixed message that holds nothing from the file", async (name, code) => {
    const err = await fails(inspect(name));
    expect(err.code).toBe(code);
    expect(err.message).not.toMatch(/SECRET/);
    expect(err.message).not.toContain(name);
  });

  it("refuses a pretty-printed single object, and a list of lists", async () => {
    const one = await fails(inspect("one_object.json", new TextEncoder().encode('{\n  "id": "SECRET-ONE",\n  "n": 1\n}\n')));
    expect(["json_malformed", "json_not_records"]).toContain(one.code);
    expect(one.message).not.toMatch(/SECRET/);
    const lists = await fails(inspect("lists.json", new TextEncoder().encode("[[1, 2], [3, 4]]")));
    expect(lists.code).toBe("json_not_records");
  });
});
