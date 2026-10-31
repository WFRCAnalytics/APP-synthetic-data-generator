// @vitest-environment node
// A local build of the release equals the workflow's for the same commit (specs/004 FR-012, SC-004):
// building twice from one dist/ gives the same checksum list and the same zip bytes, whatever the clock.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const out = join(root, "release-out");

function build(env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [join(root, "scripts", "build-release.mjs")], { cwd: root, encoding: "utf8", env: { ...process.env, ...env } });
  expect(r.status, r.stderr).toBe(0);
  const zip = readdirSync(out).find((f) => f.endsWith("-offline.zip"))!;
  return { zip: readFileSync(join(out, zip)), checksums: readFileSync(join(out, "CHECKSUMS.sha256"), "utf8") };
}

describe.skipIf(!existsSync(join(root, "dist", "index.html")))("the release build", () => {
  it("gives the same checksum list and the same zip bytes every time", async () => {
    const first = build();
    await new Promise((r) => setTimeout(r, 1500)); // a different clock second
    const second = build();
    expect(second.checksums).toBe(first.checksums);
    expect(second.zip.equals(first.zip)).toBe(true);
  }, 60_000);

  it("takes the file times from SOURCE_DATE_EPOCH, so a rebuild on another day matches too", () => {
    const a = build({ SOURCE_DATE_EPOCH: "1767225600" });
    const b = build({ SOURCE_DATE_EPOCH: "1767225600" });
    expect(a.zip.equals(b.zip)).toBe(true);
    const c = build({ SOURCE_DATE_EPOCH: "1767312000" });
    expect(c.zip.equals(a.zip)).toBe(false); // the stamped time is in the zip
    expect(c.checksums).not.toBe(a.checksums); // and the README carries the date
  }, 60_000);
});
