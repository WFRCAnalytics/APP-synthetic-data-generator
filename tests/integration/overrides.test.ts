// @vitest-environment node
// Settings the user changes on Review that need the data: confirmed sentinels, which tokens mean
// "missing", a chosen type, and a typed date pattern (FR-005 to FR-008, FR-005a). Run against the
// type zoo through the same SQL the app uses.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ColumnOverrides, ColumnProfile } from "../../src/lib/profile/types";
import { loadCsv } from "../../src/workers/profile/load";
import { countDatePattern, profileAll, profileColumn } from "../../src/workers/profile/profiler";
import { createSample } from "../../src/workers/profile/stats";
import { createNodeDb, openFromDisk, type NodeDb } from "../helpers/duckdbNode";
import { parseCsv } from "../helpers/csvParse";

const ZOO = join(__dirname, "../fixtures/zoo");
const zooPath = join(ZOO, "zoo_small.csv");
const raw = parseCsv(readFileSync(zooPath, "utf8"));
const header = raw.rows[0];
const column = (name: string) => raw.rows.slice(1).map((r) => r[header.indexOf(name)]);

let db: NodeDb;
let rowCount = 0;
const options = { threshold: 50 };

const profile = (name: string, overrides: ColumnOverrides = {}): Promise<ColumnProfile> =>
  profileColumn(db.sql, name, rowCount, options, overrides);

beforeAll(async () => {
  db = await createNodeDb();
  const opened = openFromDisk(zooPath);
  db.registerPath("zoo.csv", zooPath);
  const loaded = await loadCsv(db.sql, "zoo.csv", opened.settings, opened.columnNames);
  rowCount = loaded.rowCount;
  await createSample(db.sql, rowCount);
}, 120_000);
afterAll(() => db?.close());

describe("confirmed sentinels", () => {
  it("proposes -9, -1, 998 and 999 by default", async () => {
    expect(Object.keys((await profile("int_sentinels")).sentinels).sort()).toEqual(["-1", "-9", "998", "999"]);
  });

  it("uses exactly the codes the user confirms, with exact counts", async () => {
    const p = await profile("int_sentinels", { sentinels: ["-9"] });
    expect(p.sentinels).toEqual({ "-9": column("int_sentinels").filter((v) => v === "-9").length });
    // The other codes are now ordinary values, so they widen the range.
    if (p.summary.kind !== "numeric") throw new Error("expected numeric");
    expect(p.summary.max).toBe(999);
    expect(p.summary.min).toBe(-1);
  });

  it("accepts no sentinels at all", async () => {
    const p = await profile("int_sentinels", { sentinels: [] });
    expect(p.sentinels).toEqual({});
    if (p.summary.kind !== "numeric") throw new Error("expected numeric");
    expect(p.summary.min).toBe(-9);
  });

  it("accepts a code the profiler did not propose", async () => {
    const p = await profile("int_plain", { sentinels: ["0"] });
    expect(Object.keys(p.sentinels)).toEqual(["0"]);
    if (p.summary.kind !== "numeric") throw new Error("expected numeric");
    expect(p.summary.min).toBeGreaterThan(0);
  });

  it("ignores a code that does not occur", async () => {
    const p = await profile("int_plain", { sentinels: ["-7777"] });
    expect(p.sentinels).toEqual({});
  });
});

describe("which tokens mean missing", () => {
  it("treats the default tokens as missing", async () => {
    const p = await profile("na_NA");
    expect(p.naByToken.NA).toBe(column("na_NA").filter((v) => v === "NA").length);
  });

  // These two use tiny tables in their own database, so the shared zoo table is never replaced.
  async function tiny(csv: string, column: string, rows: number, threshold = 50, overrides: ColumnOverrides = {}) {
    const small = await createNodeDb();
    try {
      small.registerBuffer("tiny.csv", new TextEncoder().encode(csv));
      await loadCsv(small.sql, "tiny.csv", openFromDisk(zooPath).settings, [column]);
      await createSample(small.sql, rows);
      return await profileColumn(small.sql, column, rows, { threshold }, overrides);
    } finally {
      small.close();
    }
  }

  it("lets the user remove a default token so it becomes an ordinary value", async () => {
    const csv = ["code", "US", "CA", "NA", "US", "NA", "CA", "US", ""].join("\n");
    const byDefault = await tiny(csv, "code", 7);
    expect(byDefault.naByToken.NA).toBe(2);
    const kept = await tiny(csv, "code", 7, 50, { naTokens: [] });
    expect(kept.naCount).toBe(0);
    expect(kept.type).toBe("categorical");
    expect(kept.summary.kind === "categorical" && kept.summary.counts.NA).toBe(2);
  });

  it("lets the user add a token", async () => {
    const csv = ["age", "10", "20", "refused", "30", "refused", "40", ""].join("\n");
    // A low limit so four distinct ages are numbers, not codes.
    const p = await tiny(csv, "age", 6, 2, { naTokens: ["NA", "refused"] });
    expect(p.naByToken.refused).toBe(2);
    expect(p.type).toBe("integer");
  });
});

describe("a chosen type", () => {
  it("reads coded integers as integers when asked", async () => {
    const p = await profile("cat_int_codes", { type: "integer" });
    expect(p.type).toBe("integer");
    expect(p.detectedType).toBe("categorical");
    expect(p.summary.kind).toBe("numeric");
  });

  it("reads integers as decimals when asked", async () => {
    expect((await profile("int_plain", { type: "float" })).type).toBe("float");
  });

  it("reads a numeric column as categorical, keeping every label", async () => {
    const p = await profile("int_plain", { type: "categorical" });
    expect(p.type).toBe("categorical");
    expect(p.summary.kind === "categorical" && Object.keys(p.summary.counts).length).toBeGreaterThan(1000);
  });

  it("reads a text column as unsupported when asked, dropping it from the output", async () => {
    const p = await profile("cat_str_5", { type: "unsupported" });
    expect(p.type).toBe("unsupported");
    expect(p.exclude).toBe("drop");
    expect(p.summary).toEqual({ kind: "unsupported" });
  });

  it("makes a supported column of a previously unsupported one", async () => {
    const p = await profile("cat_str_51", { type: "categorical" });
    expect(p.type).toBe("categorical");
    expect(p.exclude).toBe("include");
  });

  it("reads a two-value column as boolean when asked", async () => {
    const p = await profile("bool_tf", { type: "categorical" });
    expect(p.type).toBe("categorical");
    expect((await profile("bool_tf", { type: "boolean" })).type).toBe("boolean");
  });

  it.each([
    ["cat_str_5", "integer", "words are not numbers"],
    ["cat_str_5", "boolean", "five values are not a yes/no"],
    ["cat_int_zero_pad", "integer", "leading zeros would be lost"],
    ["cat_special_chars", "float", "text"],
  ] as const)("keeps the detected type when %s cannot be read as %s (%s)", async (name, type, _why) => {
    const p = await profile(name, { type });
    expect(p.type).toBe(p.detectedType);
    expect(p.attentionReasons).toContain("override_not_possible");
    expect(p.status).toBe("needs_attention");
  });

  it("does nothing when the chosen type is the detected one", async () => {
    const p = await profile("cat_str_5", { type: "categorical" });
    expect(p.attentionReasons).not.toContain("override_not_possible");
  });
});

describe("a typed date pattern", () => {
  it("counts how many values a pattern parses", async () => {
    const good = await countDatePattern(db.sql, "date_us", "%m/%d/%Y", ["NA"], []);
    expect(good.parsed).toBe(good.total);
    const bad = await countDatePattern(db.sql, "date_us", "%d/%m/%Y", ["NA"], []);
    expect(bad.parsed).toBeLessThan(bad.total);
    expect(bad.total).toBe(good.total);
  });

  it("leaves out sentinels when counting", async () => {
    const withSentinel = await countDatePattern(db.sql, "time_hhmm_text", "%H%M", ["NA"], []);
    const without = await countDatePattern(db.sql, "time_hhmm_text", "%H%M", ["NA"], ["-9"]);
    expect(without.parsed).toBe(without.total);
    expect(withSentinel.parsed).toBeLessThan(withSentinel.total);
  });

  it("accepts a pattern that parses every value", async () => {
    const p = await profile("date_ambiguous", { datePattern: "%d/%m/%Y" });
    expect(p.type).toBe("date");
    expect(p.status).toBe("ok");
    expect(p.summary.kind === "datetime" && p.summary.format).toBe("%d/%m/%Y");
  });

  it("falls back to unsupported when the pattern does not parse every value", async () => {
    const p = await profile("date_us", { datePattern: "%d/%m/%Y" });
    expect(p.type).toBe("unsupported");
    expect(p.status).toBe("unsupported");
    expect(p.exclude).toBe("drop");
    expect(p.attentionReasons).toContain("date_format_unrecognized");
  });

  it("falls back to unsupported for a mixed-format column", async () => {
    expect((await profile("date_mixed_formats", { datePattern: "%Y-%m-%d" })).type).toBe("unsupported");
  });

  it("lets the user resolve a mixed column by picking the right pattern for a clean one", async () => {
    const p = await profile("date_iso", { datePattern: "%Y-%m-%d" });
    expect(p.type).toBe("date");
    expect(p.status).toBe("ok");
  });

  it("makes a date of any column its pattern fits", async () => {
    const p = await profile("time_hh_mm", { datePattern: "%H:%M" });
    expect(p.type).toBe("time");
    const asDate = await profile("date_year_only", { datePattern: "%Y" });
    expect(asDate.type).toBe("date");
  });

  it("rejects a pattern with an unsupported directive without touching the data", async () => {
    const p = await profile("date_iso", { datePattern: "%Y-%m-%d %Z" });
    expect(p.type).toBe("unsupported");
    expect(p.attentionReasons).toContain("date_format_unrecognized");
  });

  it("rejects a pattern that fits no value", async () => {
    expect((await profile("int_plain", { datePattern: "%Y-%m-%d" })).type).toBe("unsupported");
  });

  it("still flags sentinels in a column resolved by a typed pattern", async () => {
    const p = await profile("time_hhmm_text", { datePattern: "%H%M", sentinels: ["-9"] });
    expect(p.type).toBe("time");
    expect(p.attentionReasons).toContain("possible_sentinel");
  });
});

describe("overrides for a whole table", () => {
  it("applies each column's overrides when profiling everything again", async () => {
    const names = ["int_sentinels", "cat_int_codes", "date_ambiguous", "bool_tf"];
    const list = await profileAll(db.sql, names, rowCount, options, undefined, undefined, {
      int_sentinels: { sentinels: ["-9"] },
      cat_int_codes: { type: "integer" },
      date_ambiguous: { datePattern: "%d/%m/%Y" },
    });
    expect(Object.keys(list[0].sentinels)).toEqual(["-9"]);
    expect(list[1].type).toBe("integer");
    expect(list[2].type).toBe("date");
    expect(list[3].type).toBe("boolean"); // no override: unchanged
  });

  it("applies a different categorical limit", async () => {
    const strict = await profileColumn(db.sql, "cat_int_50", rowCount, { threshold: 20 });
    expect(strict.type).toBe("integer");
    const loose = await profileColumn(db.sql, "cat_int_51", rowCount, { threshold: 100 });
    expect(loose.type).toBe("categorical");
  });
});
