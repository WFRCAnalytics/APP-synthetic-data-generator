// @vitest-environment node
// Profiling against the real SQL (DuckDB in Node) on the type-zoo fixture: every column's detected
// type, status and reasons are checked against tests/fixtures/zoo/expected.json, and the numbers
// are checked against values computed independently from the raw CSV text.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { columnSpecOf } from "../../src/lib/spec/build";
import { maskToRegexString } from "../../src/lib/mask/mask";
import type { ColumnProfile } from "../../src/lib/profile/types";
import { loadCsv } from "../../src/workers/profile/load";
import { profileAll } from "../../src/workers/profile/profiler";
import { createNodeDb, openFromDisk, type NodeDb } from "../helpers/duckdbNode";
import { parseCsv } from "../helpers/csvParse";

const ZOO = join(__dirname, "../fixtures/zoo");
const zooPath = join(ZOO, "zoo_small.csv");
const expected = JSON.parse(readFileSync(join(ZOO, "expected.json"), "utf8")) as {
  n_rows: number;
  columns: Record<string, { type: string; status: string; reasons: string[]; assert?: string[]; na_tokens?: string[]; decimals?: number; storage?: string; format?: string; mask?: string; kind?: string }>;
};
const raw = parseCsv(readFileSync(zooPath, "utf8"));
const header = raw.rows[0];
const dataRows = raw.rows.slice(1);
const column = (name: string) => dataRows.map((r) => r[header.indexOf(name)]);

let db: NodeDb;
let profiles: Map<string, ColumnProfile>;

beforeAll(async () => {
  db = await createNodeDb();
  const opened = openFromDisk(zooPath);
  db.registerPath("zoo.csv", zooPath);
  const loaded = await loadCsv(db.sql, "zoo.csv", opened.settings, opened.columnNames);
  expect(loaded.rowCount).toBe(expected.n_rows);
  const list = await profileAll(db.sql, loaded.columnNames, loaded.rowCount, { threshold: 50 });
  profiles = new Map(list.map((p) => [p.name, p]));
}, 120_000);

afterAll(() => db?.close());

describe("detection matches the expected result for every zoo column", () => {
  for (const [name, want] of Object.entries(expected.columns)) {
    it(name, () => {
      const got = profiles.get(name);
      expect(got, `column ${name} was profiled`).toBeDefined();
      const asserted = want.assert ?? ["type", "status", "reasons"];

      if (asserted.includes("type")) expect(got!.type).toBe(want.type);

      if (asserted.includes("status")) expect(got!.status).toBe(want.status);
      if (asserted.includes("reasons")) expect([...got!.attentionReasons].sort()).toEqual([...want.reasons].sort());

      // The inferred ID pattern, written readably, matches the one the fixture was built from.
      if (want.mask && got!.summary.kind === "survey_id") expect(maskToRegexString(got!.summary.mask)).toBe(want.mask);

      // The proposed kind of a personal identifier column.
      if (want.kind && got!.summary.kind === "personal") expect(got!.summary.personalKind).toBe(want.kind);

      if (want.na_tokens && asserted.includes("type")) expect(new Set(got!.naTokens)).toEqual(new Set(want.na_tokens));
      if (want.format && asserted.includes("type") && got!.summary.kind === "datetime") expect(got!.summary.format).toBe(want.format);
      if (want.storage && got!.summary.kind === "categorical") expect(got!.summary.storage).toBe(want.storage);
    });
  }
});

describe("numbers match the raw file exactly", () => {
  const numbers = (name: string, sentinels: string[] = []) =>
    column(name)
      .filter((v) => v !== "" && !sentinels.includes(v))
      .map(Number);
  const stats = (xs: number[]) => {
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    return { min: Math.min(...xs), max: Math.max(...xs), mean, sd };
  };

  it.each(["int_plain", "int_negative", "float_2dp", "float_6dp", "float_negative"])("min, max, mean and sd of %s", (name) => {
    const got = profiles.get(name)!.summary;
    expect(got.kind).toBe("numeric");
    if (got.kind !== "numeric") return;
    const want = stats(numbers(name));
    expect(got.min).toBe(want.min);
    expect(got.max).toBe(want.max);
    expect(got.mean).toBeCloseTo(want.mean, 6);
    expect(got.sd).toBeCloseTo(want.sd, 6);
    expect(got.quantiles).toHaveLength(101);
    expect(got.quantiles[0]).toBe(want.min);
    expect(got.quantiles[100]).toBe(want.max);
    expect(got.histogram).toHaveLength(20);
    expect(got.histogram.reduce((a, b) => a + b, 0)).toBe(numbers(name).length);
  });

  it("excludes confirmed sentinels from the statistics and keeps their exact counts", () => {
    const p = profiles.get("int_sentinels")!;
    const sentinelValues = Object.keys(p.sentinels);
    expect(sentinelValues.sort()).toEqual(["-1", "-9", "998", "999"]);
    for (const s of sentinelValues) expect(p.sentinels[s]).toBe(column("int_sentinels").filter((v) => v === s).length);
    if (p.summary.kind !== "numeric") throw new Error("expected numeric");
    const want = stats(numbers("int_sentinels", sentinelValues));
    expect(p.summary.min).toBe(want.min);
    expect(p.summary.max).toBe(want.max);
  });

  it("finds decimal places, including trailing zeros", () => {
    expect((profiles.get("float_2dp")!.summary as { decimals: number }).decimals).toBe(2);
    expect((profiles.get("float_6dp")!.summary as { decimals: number }).decimals).toBe(6);
    expect((profiles.get("float_trailing_zero")!.summary as { decimals: number }).decimals).toBe(2);
  });

  it("reads thousands-separated integers as numbers", () => {
    const p = profiles.get("int_thousands")!;
    expect(p.type).toBe("integer");
    if (p.summary.kind !== "numeric") throw new Error("expected numeric");
    expect(p.summary.thousands).toBe(true);
    const want = column("int_thousands").map((v) => Number(v.replace(/,/g, "")));
    expect(p.summary.min).toBe(Math.min(...want));
    expect(p.summary.max).toBe(Math.max(...want));
  });
});

describe("categorical counts, NA counts and sentinels are exact", () => {
  it("counts every label of a categorical column", () => {
    const s = profiles.get("cat_str_5")!.summary;
    if (s.kind !== "categorical") throw new Error("expected categorical");
    const tally: Record<string, number> = {};
    for (const v of column("cat_str_5")) tally[v] = (tally[v] ?? 0) + 1;
    expect(s.counts).toEqual(tally);
  });

  it("keeps label text with commas, quotes, newlines and edge spaces intact", () => {
    const s = profiles.get("cat_special_chars")!.summary;
    if (s.kind !== "categorical") throw new Error("expected categorical");
    expect(Object.keys(s.counts).sort()).toEqual([" lead", "a,b", "line1\nline2", "plain", 'say "hi"', "trail "].sort());
  });

  it("counts a rare label once", () => {
    const s = profiles.get("cat_rare")!.summary;
    if (s.kind !== "categorical") throw new Error("expected categorical");
    expect(s.counts.RARE).toBe(1);
  });

  it.each([
    ["na_blank", { "": 0 }],
    ["na_NA", { NA: 0 }],
    ["na_N_A", { "N/A": 0 }],
    ["na_NULL", { NULL: 0 }],
    ["na_dot", { ".": 0 }],
    ["na_mixed_tokens", { "": 0, NA: 0, ".": 0 }],
  ])("counts the NA tokens of %s per token", (name, tokens) => {
    const p = profiles.get(name)!;
    for (const token of Object.keys(tokens)) {
      expect(p.naByToken[token]).toBe(column(name).filter((v) => v === token).length);
    }
    expect(p.naCount).toBe(Object.values(p.naByToken).reduce((a, b) => a + b, 0));
  });

  it("types a date column and reports its exact range in days", () => {
    const p = profiles.get("date_iso")!;
    expect(p.type).toBe("date");
    if (p.summary.kind !== "datetime") throw new Error("expected datetime summary");
    const days = column("date_iso").map((v) => Math.floor(Date.parse(`${v}T00:00:00Z`) / 86400000));
    expect(p.summary.min).toBe(Math.min(...days));
    expect(p.summary.max).toBe(Math.max(...days));
    expect(p.summary.granularity).toBe("day");
  });

  it("reports a time in seconds since midnight", () => {
    const p = profiles.get("time_hh_mm")!;
    expect(p.type).toBe("time");
    if (p.summary.kind !== "datetime") throw new Error("expected datetime summary");
    const secs = column("time_hh_mm").map((v) => Number(v.slice(0, 2)) * 3600 + Number(v.slice(3, 5)) * 60);
    expect(p.summary.min).toBe(Math.min(...secs));
    expect(p.summary.max).toBe(Math.max(...secs));
    expect(p.summary.granularity).toBe("minute");
  });
});

describe("privacy: profiles carry no values", () => {
  const unsupportedColumns = ["coord_pair", "wkt_point"];
  const describedColumns = ["email", "person_name", "first_name", "last_name", "street_address", "phone_us", "phone_intl", "free_text", "comments", "ssn_like", "url", "uuid", "ip_address", "plate", "vendor_code", "short_code_many", "zip_text", "currency_text", "email_mixed"];

  it.each(unsupportedColumns)("the profile of %s holds no cell value", (name) => {
    const p = profiles.get(name)!;
    expect(p.type).toBe("unsupported");
    expect(p.exclude).toBe("drop");
    expect(p.summary).toEqual({ kind: "unsupported" });
    const text = JSON.stringify(p);
    for (const v of column(name).slice(0, 300)) if (v.length > 6) expect(text.includes(v)).toBe(false);
  });

  it("a latitude and a longitude are decimals marked as coordinates, kept to their bounding box in the spec", () => {
    for (const [name, axis] of [["lat", "lat"], ["lon", "lon"]] as const) {
      const p = profiles.get(name)!;
      expect(p.type).toBe("float");
      expect(p.coordinate).toBe(axis);
      const spec = JSON.stringify(columnSpecOf(p));
      expect(spec).not.toContain("quantiles");
      expect(spec).toContain('"coordinate":"' + axis + '"');
    }
  });

  it.each(describedColumns)("the profile of %s is counts, lengths and shapes, never a value", (name) => {
    const p = profiles.get(name)!;
    expect(["personal", "free_text", "short_string"]).toContain(p.summary.kind);
    const text = JSON.stringify(p);
    for (const v of column(name).slice(0, 400)) if (v.length > 6) expect(text.includes(v), `${name} leaks "${v}"`).toBe(false);
  });

  it("an SSN-style column is unsupported and left out until acknowledged, with its figures kept", () => {
    const p = profiles.get("ssn_like")!;
    expect(p.type).toBe("unsupported");
    expect(p.exclude).toBe("drop");
    expect(p.attentionReasons).toContain("ssn_needs_acknowledgement");
    expect(p.summary).toMatchObject({ kind: "personal", personalKind: "ssn" });
  });

  it("no profile of an ID column holds an ID value", () => {
    for (const name of ["hh_id", "padded_id", "site_id", "hh_prefix_id", "row_id", "few_distinct_hh_id"]) {
      const text = JSON.stringify(profiles.get(name));
      for (const v of column(name).slice(0, 300)) if (v.length >= 5) expect(text.includes(`"${v}"`)).toBe(false);
    }
  });
});

describe("column order and counts", () => {
  it("profiles every column once, in file order", () => {
    expect([...profiles.keys()]).toEqual(header);
    expect(profiles.size).toBe(Object.keys(expected.columns).length);
  });
});
