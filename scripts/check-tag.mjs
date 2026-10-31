// Fails unless the git tag is the release of the version in package.json (specs/004 R10).
//
//   node scripts/check-tag.mjs [tag] [--dry-run]     (tag defaults to $GITHUB_REF_NAME)
//
// --dry-run also accepts a pre-release of the version (v0.2.0-rc1), so the release workflow can be tried
// without making a real release.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkTag } from "./release-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const tag = args.find((a) => !a.startsWith("--")) || process.env.GITHUB_REF_NAME;

if (!tag) {
  console.error("check-tag: no tag given and GITHUB_REF_NAME is not set.");
  process.exit(1);
}

const result = checkTag(tag, version, { dryRun });
if (!result.ok) {
  console.error(`check-tag: ${result.reason}`);
  process.exit(1);
}
console.log(`check-tag: ${tag} matches package.json version ${version}.`);
