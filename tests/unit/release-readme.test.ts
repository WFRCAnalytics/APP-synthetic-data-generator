// @vitest-environment node
// The one-page README of the release (specs/004 FR-006): it says how to open the app on each system, which
// browsers, what the launcher does, what to do if it does not start, how to check that nothing leaves the
// computer and that the files are the released ones, the version and the licences. It fits a page.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const text = readFileSync(join(process.cwd(), "release", "README.template.txt"), "utf8").replace(/\r\n/g, "\n");
const lines = text.split("\n").filter((_, i, all) => !(i === all.length - 1 && all[i] === ""));

describe("README.template.txt", () => {
  it("has the sections the spec asks for", () => {
    for (const heading of ["HOW TO OPEN IT", "BROWSERS", "WHAT THE LAUNCHER DOES", "IF IT DOES NOT START", "CHECK THAT NOTHING LEAVES YOUR COMPUTER", "CHECK THAT THE FILES ARE THE ONES RELEASED", "VERSION", "LICENCES"]) {
      expect(text, heading).toContain(heading);
    }
  });

  it("gives the steps for Windows and for macOS or Linux", () => {
    expect(text).toContain("start.cmd");
    expect(text).toContain("./start.sh");
    expect(text).toMatch(/Press Ctrl\+C/);
    expect(text).toMatch(/close the window/);
  });

  it("says plainly what the launcher is and that it stays on this computer", () => {
    expect(text).toMatch(/extra step/);
    expect(text).toContain("127.0.0.1");
    expect(text).toMatch(/no connection to the internet/);
  });

  it("explains how to check that nothing leaves the computer and that the files are as released", () => {
    expect(text).toMatch(/0 outside this site/);
    expect(text).toContain("Network tab");
    expect(text).toContain("CHECKSUMS.sha256");
    expect(text).toContain("Get-FileHash");
    expect(text).toContain("shasum -a 256 -c CHECKSUMS.sha256");
  });

  it("states the version in the form the verifier reads, and points to the licences", () => {
    expect(text).toMatch(/Version \{\{APP_VERSION\}\} \(writes spec file version \{\{SPEC_VERSION\}\}\)/);
    expect(text).toContain("LICENSES.md");
  });

  it("fits one page: at most 75 lines of at most 100 characters", () => {
    expect(lines.length).toBeLessThanOrEqual(75);
    expect(lines.filter((l) => l.length > 100)).toEqual([]);
  });

  it("uses only the placeholders the build fills", () => {
    const found = new Set(text.match(/\{\{[A-Z_]+\}\}/g));
    expect([...found].sort()).toEqual(["{{APP_VERSION}}", "{{DATE}}", "{{SPEC_VERSION}}"]);
  });
});
