// Loading a JSON file into the all-text `src` table (specs/007 research R2, R3). Records are read as whole JSON
// values, and only structure is asked of them: how many, which top-level keys in first-seen order, the JSON type of
// each key per record, and whether a key exists. The text of a value passes through the engine only in the load
// into `src`, inside this worker, exactly as a CSV's does. A key holding an object or a list is not read at all:
// it loads as all-NULL and is marked unsupported. Messages from the engine are never passed on: it can quote a
// character of the file, so every failure becomes a fixed message.

import { AppError, sanitizeError } from "../../lib/errors";
import { describeKey } from "../../lib/json/kinds";
import { JSON_UNSUPPORTED_TEXT, unsupportedReasonOfKind, type JsonKind, type JsonLayout, type JsonUnsupportedReason } from "../../lib/json/types";
import { EMPTY_TEXT_TOKEN } from "../../lib/spec/types";
import { workbookTooLarge } from "../../features/ingest/sizeWarnings";
import type { LoadResult } from "./load";
import { ident, lit, SRC, toNumber, type SqlRunner } from "./sql";

export interface JsonKeyInfo {
  /** The name of the column in the table: the key itself, or a position name when the key is empty. */
  name: string;
  kind: JsonKind;
  nulls: number;
  missing: number;
  /** The key held kinds that cannot be one; it is read as text. */
  mixed: boolean;
  unsupported: JsonUnsupportedReason | null;
  /** The key is empty text, so the reader named the column by its position. */
  renamed: boolean;
  /** The key exactly as in the file (kept inside the worker, used to address the value). */
  key: string;
}

export interface JsonInfo {
  rowCount: number;
  layout: JsonLayout;
  /** An estimate of the data once opened, from the file's size (never a value). */
  expandedBytes: number;
  keys: JsonKeyInfo[];
}

export { JSON_UNSUPPORTED_TEXT };

const EMPTY_TOKEN_SQL = `chr(${EMPTY_TEXT_TOKEN.charCodeAt(0)})`;

/** The `read_json_objects(...)` call for a registered file, read in the form the content showed. */
export const readSql = (virtualName: string, layout: JsonLayout): string => `read_json_objects(${lit(virtualName)}, format = ${lit(layout.form === "array" ? "array" : "newline_delimited")})`;

/** A JSON pointer (RFC 6901) for a top-level key, as a SQL string expression; any key text is safe in it. */
const pointerOf = (key: string): string => lit(`/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`);

/** A failure while reading: the file's problem becomes a fixed message, memory and cancel pass through. */
function asFileProblem(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const safe = sanitizeError(err);
  return ["csv_parse_error", "conversion_error", "engine_error", "internal_error", "file_unreadable"].includes(safe.code) ? new AppError("json_malformed") : safe;
}

/** Structure of a registered JSON file, read without taking a value out of the engine. */
export async function inspectJson(sql: SqlRunner, virtualName: string, layout: JsonLayout, fileSize: number): Promise<JsonInfo> {
  try {
    const records = readSql(virtualName, layout);
    const [shape] = await sql.all(`SELECT count(*) AS n, count(*) FILTER (WHERE json_type(json) <> 'OBJECT') AS other FROM ${records}`);
    const rowCount = toNumber(shape.n);
    if (rowCount === 0) throw new AppError("json_empty");
    if (toNumber(shape.other) > 0) throw new AppError("json_not_records");

    // A repeated key inside one record cannot be told apart safely: refuse it.
    const [dup] = await sql.all(`SELECT count(*) AS n FROM (SELECT json_keys(json)::VARCHAR[] AS ks FROM ${records}) WHERE len(ks) <> len(list_distinct(ks))`);
    if (toNumber(dup.n) > 0) throw new AppError("json_duplicate_key");

    // One pass: for every (key, JSON type) the number of records, and where the key was first seen.
    const rows = await sql.all(
      `SELECT k, t, count(*) AS c, min(rn) AS first_row, arg_min(pos, rn) AS first_pos FROM (
         SELECT rn, k, pos, json_type(json, '/' || replace(replace(k, '~', '~0'), '/', '~1')) AS t FROM (
           SELECT rn, json, unnest(ks) AS k, unnest(range(1, len(ks) + 1)) AS pos FROM (
             SELECT row_number() OVER () AS rn, json, json_keys(json)::VARCHAR[] AS ks FROM ${records}
           )
         )
       ) GROUP BY k, t ORDER BY first_row, first_pos`,
    );

    const order: string[] = [];
    const where = new Map<string, { first: number; pos: number }>();
    const types = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const k = String(r.k);
      const t = r.t === null || r.t === undefined ? "NULL" : String(r.t);
      const entry = types.get(k) ?? {};
      entry[t] = (entry[t] ?? 0) + toNumber(r.c);
      types.set(k, entry);
      const first = toNumber(r.first_row);
      const pos = toNumber(r.first_pos);
      const seen = where.get(k);
      if (!seen) {
        where.set(k, { first, pos });
        order.push(k);
      } else if (first < seen.first || (first === seen.first && pos < seen.pos)) where.set(k, { first, pos });
    }
    order.sort((a, b) => {
      const x = where.get(a)!;
      const y = where.get(b)!;
      return x.first - y.first || x.pos - y.pos;
    });
    if (order.length === 0) throw new AppError("json_empty");

    const keys: JsonKeyInfo[] = order.map((key, i) => {
      const d = describeKey({ types: types.get(key) ?? {}, records: rowCount });
      const renamed = key === "";
      return { key, name: renamed ? `column${i + 1}` : key, kind: d.kind, nulls: d.nulls, missing: d.missing, mixed: d.mixed, unsupported: unsupportedReasonOfKind(d.kind), renamed };
    });

    // Two keys can end up with the same name when one is empty; make the later ones distinct.
    const used = new Set<string>();
    for (const k of keys) {
      let name = k.name;
      while (used.has(name)) name += "_";
      k.name = name;
      used.add(name);
    }

    const info: JsonInfo = { rowCount, layout, expandedBytes: fileSize, keys };
    if (workbookTooLarge(info.expandedBytes)) throw new AppError("json_too_large");
    return info;
  } catch (err) {
    throw asFileProblem(err);
  }
}

/** The text one key becomes: what the same value would be in a CSV. */
function textOf(key: JsonKeyInfo): string {
  const c = ident(key.name);
  if (key.unsupported || key.kind === "null") return `CAST(NULL AS VARCHAR) AS ${c}`; // never read
  const p = pointerOf(key.key);
  const x = `json_extract_string(json, ${p})`;
  const t = `json_type(json, ${p})`;
  switch (key.kind) {
    case "string":
      // Text as it is (a mixed key's numbers and booleans too); the empty string is not a missing value.
      return `CASE WHEN ${t} = 'BOOLEAN' THEN upper(${x}) WHEN ${x} = '' THEN ${EMPTY_TOKEN_SQL} ELSE ${x} END AS ${c}`;
    case "boolean":
      return `CASE WHEN ${x} IS NULL THEN NULL ELSE upper(${x}) END AS ${c}`;
    default:
      // A number: a whole value the engine typed as a double reads as 1000, not 1000.0.
      return `CASE WHEN ${t} = 'DOUBLE' AND ${x} LIKE '%.0' THEN substr(${x}, 1, length(${x}) - 2) ELSE ${x} END AS ${c}`;
  }
}

/** Creates the `src` table from a registered JSON file. */
export async function loadJson(sql: SqlRunner, virtualName: string, info: JsonInfo): Promise<LoadResult> {
  try {
    const select = info.keys.map(textOf).join(", ");
    await sql.run(`CREATE OR REPLACE TABLE ${SRC} AS SELECT ${select} FROM ${readSql(virtualName, info.layout)}`);
    const [row] = await sql.all(`SELECT count(*) AS n FROM ${SRC}`);
    return { rowCount: toNumber(row.n), columnNames: info.keys.map((k) => k.name) };
  } catch (err) {
    throw asFileProblem(err);
  }
}
