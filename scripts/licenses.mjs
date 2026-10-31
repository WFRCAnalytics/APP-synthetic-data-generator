// The licence notices that travel with a release (specs/004 FR-003, R11): the app's own licence, the
// licence of every runtime dependency that ends up in the build, and the notice for the DuckDB Excel
// extension. Generated from the installed packages, so it cannot drift from what is bundled.
// A package with neither a licence file nor a licence identifier fails the build.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LICENCE_FILE = /^(licen[cs]e|copying)(\.(md|txt))?$/i;

/** The text of a package's licence file, or null when it ships none. */
function licenceText(dir) {
  const file = readdirSync(dir).find((name) => LICENCE_FILE.test(name));
  return file ? readFileSync(join(dir, file), "utf8").trim() : null;
}

/**
 * @param {string} root the project folder (with package.json, LICENSE and node_modules)
 * @returns {string} the text of LICENSES.md
 */
export function buildLicenses(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const sections = [];

  sections.push(`## ${pkg.name} ${pkg.version} (this app)\n\nLicence: ${pkg.license}\n\n${readFileSync(join(root, "LICENSE"), "utf8").trim()}`);

  for (const name of Object.keys(pkg.dependencies ?? {}).sort()) {
    const dir = join(root, "node_modules", name);
    if (!existsSync(dir)) throw new Error(`licenses: ${name} is not installed; run npm ci first`);
    const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const text = licenceText(dir);
    const id = typeof meta.license === "string" ? meta.license : meta.license?.type;
    if (!text && !id) throw new Error(`licenses: ${name} has no licence file and no licence identifier`);
    const source = typeof meta.repository === "string" ? meta.repository : meta.repository?.url;
    const body = text ?? `The package ships no licence file; its package.json declares the licence ${id}.${source ? ` Source: ${source}` : ""}`;
    sections.push(`## ${name} ${meta.version}\n\nLicence: ${id ?? "see text"}\n\n${body}`);
  }

  sections.push(
    [
      "## DuckDB Excel extension",
      "",
      "Licence: MIT",
      "",
      "The Excel reader is DuckDB's `excel` extension, built by the DuckDB project (https://duckdb.org) and",
      "released under the MIT licence. It is included in this folder as a file, loaded from here, and never",
      "downloaded when you use the app.",
    ].join("\n"),
    [
      "## Brand assets",
      "",
      "The WFRC logos in the page header belong to the Wasatch Front Regional Council and are included for",
      "this tool's header only. The MIT licence of the app does not cover them.",
    ].join("\n"),
  );

  return `# Licences\n\nThe licences of this app and of the components bundled with it.\n\n${sections.join("\n\n---\n\n")}\n`;
}

// `node scripts/licenses.mjs` prints the text, to look at it.
if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) process.stdout.write(buildLicenses(process.cwd()));
