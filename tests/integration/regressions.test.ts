// @vitest-environment node
// Bugs found by the corpus robustness test, pinned so they cannot come back.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planTable } from "../../src/lib/generate/table";
import { renderAll } from "../../src/lib/generate/render";
import { DEFAULT_DIALECT, formatRow } from "../../src/lib/csv/writer";
import { buildSpec } from "../../src/lib/spec/build";
import { validateSpec } from "../../src/lib/spec/validate";
import { loadCsv } from "../../src/workers/profile/load";
import { profileAll } from "../../src/workers/profile/profiler";
import { createNodeDb, type NodeDb } from "../helpers/duckdbNode";
import { profileBytes } from "../helpers/pipeline";
import type { FileSettings } from "../../src/lib/profile/types";

let db: NodeDb;
beforeAll(async () => {
  db = await createNodeDb();
}, 60_000);
afterAll(() => db?.close());

const settings: FileSettings = {
  encoding: "utf-8",
  bom: false,
  delimiter: ",",
  quote: '"',
  quoteStyle: "minimal",
  lineEnding: "lf",
  header: true,
  headerQuoted: false,
  trailingNewline: true,
};
const bytes = (text: string) => new TextEncoder().encode(text);

describe("a column with more than 15 decimal places", () => {
  it("is capped at 15 so the spec still validates", async () => {
    const text = "x\n" + Array.from({ length: 40 }, (_, i) => `0.${String(1234567890123456 + i)}`).join("\n") + "\n";
    const fake = await profileBytes(db, bytes(text), "long_decimals.csv");
    const p = fake.profiles[0];
    expect(p.type).toBe("float");
    expect(p.summary.kind === "numeric" && p.summary.decimals).toBe(15);
    expect(validateSpec(fake.spec).ok).toBe(true);
  });
});

describe("a row with one empty field", () => {
  it("is written as \"\" so it is not mistaken for a blank line", () => {
    expect(formatRow([""], DEFAULT_DIALECT)).toBe('""\n');
    expect(formatRow(["a"], DEFAULT_DIALECT)).toBe("a\n");
    expect(formatRow(["", ""], DEFAULT_DIALECT)).toBe(",\n");
    expect(formatRow([""], { ...DEFAULT_DIALECT, lineEnding: "crlf" })).toBe('""\r\n');
  });

  it("writes an empty field plainly when the file has no quote character", () => {
    expect(formatRow([""], { ...DEFAULT_DIALECT, quote: null })).toBe("\n");
  });

  it("keeps the row count of a single-column file with missing values", async () => {
    const text = "a\n1\n\"\"\n2\n\"\"\n3\n"; // two missing values
    const source = await profileBytes(db, bytes(text), "single.csv");
    expect(source.rowCount).toBe(5);
    const spec = buildSpec({ fileName: "single.csv", settings: source.settings, rowCount: 5, seed: 1, keepOriginalName: false, threshold: 50, profiles: source.profiles });
    const out = renderAll(planTable(spec));
    expect(new TextDecoder().decode(out).split("\n").filter((l) => l === '""')).toHaveLength(2);
    const back = await profileBytes(db, out, "single_fake.csv");
    expect(back.rowCount).toBe(5);
  });
});

describe("loading a second file in the same session", () => {
  async function loadAndProfile(rows: number) {
    const csv = "n\n" + Array.from({ length: rows }, (_, i) => String(i)).join("\n") + "\n";
    db.registerBuffer(`rows_${rows}.csv`, bytes(csv));
    const loaded = await loadCsv(db.sql, `rows_${rows}.csv`, settings, ["n"]);
    return profileAll(db.sql, loaded.columnNames, loaded.rowCount, { threshold: 50 });
  }

  it("works after a large file left a sample table behind", async () => {
    const big = await loadAndProfile(60_000); // above the sample size, so the sample is a table
    expect(big).toHaveLength(1);
    const small = await loadAndProfile(100); // below it, so the sample is a view
    expect(small).toHaveLength(1);
    const again = await loadAndProfile(70_000); // and back to a table
    expect(again).toHaveLength(1);
  });
});
