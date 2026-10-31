// @vitest-environment node
// Robustness: other people's CSV edge-case files (DuckDB's test data, csv-spectrum) run through the
// whole pipeline. They carry no expected types, so the assertions are only: the app never crashes,
// a file it cannot read fails with a clear message that holds no cell value, and a file it can read
// gives a valid spec and a fake file that reads back with the same shape.
//
// Needs `node scripts/fetch-corpus.mjs`; skipped (with a message) when the folder is absent.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError, sanitizeError } from "../../src/lib/errors";
import { validateSpec } from "../../src/lib/spec/validate";
import { createNodeDb, openFromDisk, type NodeDb } from "../helpers/duckdbNode";
import { parseCsv } from "../helpers/csvParse";
import { profileBytes, profilePath, renderSpec } from "../helpers/pipeline";

const CORPUS = join(__dirname, "../../.fixtures/corpus");
const MAX_BYTES = 20 * 1024 * 1024;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "public" ? [] : files(p);
    return /\.(csv|tsv|txt)$/i.test(e.name) && statSync(p).size <= MAX_BYTES ? [p] : [];
  });
}

const present = existsSync(CORPUS);
const list = present ? files(CORPUS).sort() : [];
let db: NodeDb;

beforeAll(async () => {
  if (present) db = await createNodeDb();
}, 60_000);
afterAll(() => db?.close());

// Field values of the file that an error message must never repeat.
function secretsOf(path: string): string[] {
  try {
    const text = readFileSync(path, "utf8");
    const { rows } = parseCsv(text.slice(0, 200_000), text.includes("\t") && !text.includes(",") ? "\t" : text.includes(";") && !text.includes(",") ? ";" : ",");
    return [...new Set(rows.slice(1, 60).flat().filter((v) => v.length >= 5))];
  } catch {
    return [];
  }
}

describe.skipIf(!present)("corpus files go through the pipeline without crashing", () => {
  it("found corpus files", () => {
    expect(list.length).toBeGreaterThan(50);
  });

  for (const path of list) {
    const name = relative(CORPUS, path).replace(/\\/g, "/");
    it(name, async () => {
      const opened = openFromDisk(path);

      // Files the app turns away before loading: it says so, and shows no row.
      if (opened.empty || opened.unsupportedEncoding || !opened.consistent) return;

      let source;
      try {
        source = await profilePath(db, path);
      } catch (err) {
        // The worker sanitizes every error before posting it; the message must hold no cell value.
        const safe = sanitizeError(err);
        expect(safe).toBeInstanceOf(AppError);
        for (const secret of secretsOf(path)) expect(safe.message).not.toContain(secret);
        return;
      }

      // A valid spec, always.
      const spec = validateSpec(source.spec);
      if (!spec.ok) throw new Error(`${name}: invalid spec: ${JSON.stringify(spec.problems.slice(0, 3))}`);

      // The fake file generates, and reads back with the same shape.
      const bytes = renderSpec(source.spec);
      const included = source.profiles.filter((p) => p.exclude !== "drop");
      if (included.length === 0 || source.rowCount === 0) return;
      const fake = await profileBytes(db, bytes, `fake_${name.replace(/[^a-z0-9]/gi, "_")}`, source.settings.header);
      expect(fake.rowCount).toBe(source.rowCount);
      expect(fake.columnNames.length).toBe(included.length);
    }, 60_000);
  }
});

describe.skipIf(present)("corpus files (not downloaded)", () => {
  it.skip("run `node scripts/fetch-corpus.mjs` to enable these tests", () => {});
});
