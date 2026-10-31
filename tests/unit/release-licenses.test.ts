// @vitest-environment node
// The licence notices in a release (specs/004 FR-003): every bundled component is named with its
// licence, and a component with no licence information fails the build instead of shipping without one.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildLicenses } from "../../scripts/licenses.mjs";

const here = process.cwd();

describe("the real project", () => {
  const text = buildLicenses(here);

  it("holds the app's licence and every runtime dependency", () => {
    expect(text).toContain("MIT License");
    expect(text).toContain("Wasatch Front Regional Council");
    for (const name of ["@duckdb/duckdb-wasm", "@faker-js/faker", "react", "react-dom", "lucide-react", "valibot", "@tanstack/react-virtual", "@fontsource/inter"]) {
      expect(text).toContain(`## ${name} `);
    }
  });

  it("names the Excel extension and the brand assets, and has no gaps", () => {
    expect(text).toContain("## DuckDB Excel extension");
    expect(text).toContain("## Brand assets");
    expect(text).not.toMatch(/Licence: (undefined|null)|^## .* (undefined|null)$/m);
  });

  it("says plainly when a package ships no licence file", () => {
    expect(text).toMatch(/@duckdb\/duckdb-wasm[\s\S]*?ships no licence file; its package\.json declares the licence MIT/);
  });
});

describe("a project with a component that has no licence", () => {
  const dir = mkdtempSync(join(tmpdir(), "rel lic "));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const project = (dependency: Record<string, unknown>) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0", license: "MIT", dependencies: { dep: "1" } }));
    writeFileSync(join(dir, "LICENSE"), "MIT License\n");
    mkdirSync(join(dir, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "dep", "package.json"), JSON.stringify({ name: "dep", version: "1.0.0", ...dependency }));
  };

  it("fails the build", () => {
    project({});
    expect(() => buildLicenses(dir)).toThrow(/dep has no licence file and no licence identifier/);
  });

  it("accepts an identifier without a file, and a file without an identifier", () => {
    project({ license: "ISC" });
    expect(buildLicenses(dir)).toContain("declares the licence ISC");
    project({});
    writeFileSync(join(dir, "node_modules", "dep", "LICENCE.txt"), "Some licence text");
    expect(buildLicenses(dir)).toContain("Some licence text");
  });

  it("fails clearly when a dependency is not installed", () => {
    rmSync(join(dir, "node_modules"), { recursive: true, force: true });
    expect(() => buildLicenses(dir)).toThrow(/dep is not installed/);
  });
});
