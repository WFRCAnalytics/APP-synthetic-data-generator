// @vitest-environment node
// The verify-roundtrip script (SC-004) must pass on a real fake file and fail on a wrong one.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNodeDb, type NodeDb } from "../helpers/duckdbNode";
import { profilePath, renderSpec } from "../helpers/pipeline";

const ZOO = join(__dirname, "../fixtures/zoo");
const SCRIPT = join(__dirname, "../../scripts/verify-roundtrip.mjs");
let db: NodeDb;
let dir: string;

beforeAll(async () => {
  db = await createNodeDb();
  dir = mkdtempSync(join(tmpdir(), "verify-"));
}, 60_000);
afterAll(() => db?.close());

const run = (real: string, fake: string) => spawnSync(process.execPath, [SCRIPT, real, fake], { encoding: "utf8" });

describe("verify-roundtrip", () => {
  it("passes for a generated fake file", async () => {
    const real = join(ZOO, "quote_percolumn.csv");
    const source = await profilePath(db, real);
    const fake = join(dir, "fake.csv");
    writeFileSync(fake, renderSpec(source.spec));
    const result = run(real, fake);
    expect(result.stdout).toMatch(/^OK:/m);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("left out by the app");
  });

  it("passes for the type zoo, reporting the columns it left out", async () => {
    const real = join(ZOO, "zoo_small.csv");
    const source = await profilePath(db, real);
    const fake = join(dir, "zoo_fake.csv");
    writeFileSync(fake, renderSpec(source.spec));
    const result = run(real, fake);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/column\(s\) in the real file are not in the fake file/);
  });

  it("fails when the delimiter, the row count or a column type differs", () => {
    const real = join(ZOO, "variant_utf8.csv");
    const wrong = join(dir, "wrong.csv");
    writeFileSync(wrong, "id;amount\n1;abc\n");
    const result = run(real, wrong);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/difference/);
  });

  it("explains its usage when given no files", () => {
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage");
  });
});
