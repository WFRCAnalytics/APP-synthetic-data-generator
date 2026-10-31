// @vitest-environment node
// The tag check the release workflow runs first (specs/004 FR-010, R10): a release is only made from the tag
// `v<version>` where the version is the one in package.json.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;

function check(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [join(root, "scripts", "check-tag.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GITHUB_REF_NAME: "", ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("check-tag", () => {
  it("passes for the tag that equals the package version", () => {
    const r = check([`v${version}`]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`v${version}`);
  });

  it("reads the tag from the workflow's GITHUB_REF_NAME when none is given", () => {
    expect(check([], { GITHUB_REF_NAME: `v${version}` }).code).toBe(0);
  });

  it("fails for another tag, naming the version it expected", () => {
    const r = check(["v9.9.9"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`v${version}`);
    expect(r.out).toContain("9.9.9");
  });

  it("fails for a tag without v, and for a pre-release tag", () => {
    expect(check([version]).code).toBe(1);
    expect(check([`v${version}-rc1`]).code).toBe(1);
  });

  it("allows a pre-release of this version with --dry-run only", () => {
    expect(check([`v${version}-rc1`, "--dry-run"]).code).toBe(0);
    expect(check(["v9.9.9-rc1", "--dry-run"]).code).toBe(1);
  });

  it("fails when there is no tag at all", () => {
    const r = check([]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/no tag/i);
  });
});
