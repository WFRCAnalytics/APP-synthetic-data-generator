// Variable labels as column descriptions (specs/023): kept on the profile, written to the spec, read back, listed in the README for
// agents, and refused when they are not plain short text.
import { describe, expect, it } from "vitest";
import { applyEdits } from "../../src/lib/profile/edits";
import { agentReadme } from "../../src/lib/readme/agentReadme";
import { buildSpec } from "../../src/lib/spec/build";
import { profilesFromSpec } from "../../src/lib/spec/toProfiles";
import { SPEC_VERSION, type SpecFile } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";

const spec = (description?: string): SpecFile => ({
  spec_version: SPEC_VERSION,
  source: { format: "csv", file_name: "t.csv", encoding: "utf-8", delimiter: ",", quote: '"', quote_style: "minimal", line_ending: "lf", trailing_newline: true, header: true },
  n_rows: 10,
  seed: 1,
  columns: [{ name: "age", type: "integer", mode: "uniform", min: 18, max: 90, mean: 50, sd: 10, decimals: 0, quantiles: Array.from({ length: 101 }, (_, i) => 18 + (72 * i) / 100), ...(description ? { description } : {}) }],
});

describe("column descriptions", () => {
  it("go from the profile to the spec and back", () => {
    const profiles = profilesFromSpec(spec().columns);
    const edited = profiles.map((p) => applyEdits(p, { description: "  Age of the respondent  " }));
    expect(edited[0].description).toBe("Age of the respondent");
    const built = buildSpec({ fileName: "t.csv", settings: { encoding: "utf-8", bom: false, delimiter: ",", quote: '"', quoteStyle: "minimal", lineEnding: "lf", header: true, headerQuoted: false, trailingNewline: true }, rowCount: 10, seed: 1, keepOriginalName: false, threshold: 1, profiles: edited });
    expect(built.columns[0].description).toBe("Age of the respondent");
    expect(profilesFromSpec(built.columns)[0].description).toBe("Age of the respondent");
    expect(applyEdits(edited[0], { description: null }).description).toBeUndefined();
  });

  it("are valid in a spec when short, and refused when empty or too long", () => {
    expect(validateSpec(JSON.parse(JSON.stringify(spec("Age")))).ok).toBe(true);
    expect(validateSpec(JSON.parse(JSON.stringify(spec("x".repeat(201))))).ok).toBe(false);
    const empty = JSON.parse(JSON.stringify(spec("Age")));
    empty.columns[0].description = "";
    expect(validateSpec(empty).ok).toBe(false);
  });

  it("are a Meaning column in the README only when a column has one", () => {
    const opts = { fakeFileName: "t_fake.csv", seed: 1, appVersion: "0.5.0" };
    expect(agentReadme(spec("Age of the respondent"), opts)).toContain("| Column | Meaning | Kind | Holds | Missing |");
    expect(agentReadme(spec("Age of the respondent"), opts)).toContain("| Age of the respondent |");
    expect(agentReadme(spec(), opts)).toContain("| Column | Kind | Holds | Missing |");
  });
});
