// Coordinates (specs/013): a latitude, a longitude or a map position keeps only its bounding box and decimal places in the
// spec, is spread evenly inside the box, and can be turned off or on by the person.

import { describe, expect, it } from "vitest";
import { boxFits, guessAxis } from "../../src/lib/classify/coordinate";
import { renderAll } from "../../src/lib/generate/render";
import { planTable } from "../../src/lib/generate/table";
import { applyEdits } from "../../src/lib/profile/edits";
import type { ColumnProfile } from "../../src/lib/profile/types";
import { agentReadme } from "../../src/lib/readme/agentReadme";
import { columnSpecOf } from "../../src/lib/spec/build";
import { profileFromSpec } from "../../src/lib/spec/toProfiles";
import { SPEC_VERSION, type ColumnSpec, type SpecFile } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";
import { summaryLines } from "../../src/features/review/summary";

describe("guessAxis", () => {
  it("takes a column for a latitude or a longitude by its name and its range", () => {
    expect(guessAxis("lat", 40.5, 41.2)).toBe("lat");
    expect(guessAxis("Home_Latitude", 40.5, 41.2)).toBe("lat");
    expect(guessAxis("trip_lon", -112.1, -111.5)).toBe("lon");
    expect(guessAxis("lng", -112.1, -111.5)).toBe("lon");
  });

  it("does not take a name that fits with a range that cannot be the axis", () => {
    expect(guessAxis("lat", 0, 400)).toBeNull();
    expect(guessAxis("longitude", -500, 20)).toBeNull();
  });

  it("takes projected positions only when the range is large", () => {
    expect(guessAxis("easting", 400000, 480000)).toBe("x");
    expect(guessAxis("y_coord", 4480000, 4540000)).toBe("y");
    expect(guessAxis("x", 0, 20)).toBeNull();
  });

  it("does not take other names", () => {
    expect(guessAxis("platform", 0, 10)).toBeNull();
    expect(guessAxis("age", 18, 90)).toBeNull();
  });

  it("knows which boxes fit", () => {
    expect(boxFits("lat", -90, 90)).toBe(true);
    expect(boxFits("lat", -91, 0)).toBe(false);
    expect(boxFits("lon", -180, 180)).toBe(true);
    expect(boxFits("x", -1e9, 1e9)).toBe(true);
    expect(boxFits("x", 5, 1)).toBe(false);
  });
});

const lat: ColumnProfile = {
  name: "lat",
  outputName: "lat",
  detectedType: "float",
  type: "float",
  status: "ok",
  attentionReasons: [],
  naTokens: [],
  naCount: 0,
  naByToken: {},
  sentinels: {},
  exclude: "include",
  quoted: false,
  mode: "match_shape",
  coordinate: "lat",
  summary: {
    kind: "numeric",
    min: 40.51,
    max: 41.19,
    mean: 40.8,
    sd: 0.2,
    decimals: 5,
    quantiles: Array.from({ length: 101 }, (_, i) => 40.51 + (0.68 * i) / 100),
    histogram: new Array(20).fill(0.5),
  },
};

describe("a coordinate in the spec", () => {
  it("keeps the bounding box and decimals, and no mean, spread or percentiles", () => {
    const col = columnSpecOf(lat) as ColumnSpec & {
      mean?: number;
      sd?: number;
      quantiles?: number[];
    };
    expect(col).toMatchObject({
      type: "float",
      coordinate: "lat",
      mode: "uniform",
      min: 40.51,
      max: 41.19,
      decimals: 5,
    });
    expect(col.mean).toBeUndefined();
    expect(col.sd).toBeUndefined();
    expect(col.quantiles).toBeUndefined();
    expect(JSON.stringify(col)).not.toContain("40.8");
  });

  it("comes back as a coordinate, and the person can turn it off or choose an axis", () => {
    expect(profileFromSpec(columnSpecOf(lat)).coordinate).toBe("lat");
    expect(applyEdits(lat, { coordinate: null }).coordinate).toBeUndefined();
    expect(applyEdits({ ...lat, coordinate: undefined }, { coordinate: "lon" }).coordinate).toBe(
      "lon",
    );
  });

  it("turned off, the column is an ordinary decimal with its mean, spread and percentiles again", () => {
    const col = columnSpecOf(applyEdits(lat, { coordinate: null })) as ColumnSpec & {
      quantiles?: number[];
    };
    expect(col.quantiles).toHaveLength(101);
    expect((col as { coordinate?: string }).coordinate).toBeUndefined();
  });

  it("says in the summary lines that only the box is kept", () => {
    expect(summaryLines(lat).join(" ")).toMatch(
      /Latitude from 40.51 to 41.19.*Only the bounding box is kept/s,
    );
  });

  const spec = (col: object): SpecFile =>
    ({
      spec_version: SPEC_VERSION,
      source: {
        format: "csv",
        file_name: "t.csv",
        encoding: "utf-8",
        delimiter: ",",
        header: true,
      },
      n_rows: 600,
      seed: 3,
      columns: [col],
    }) as unknown as SpecFile;

  it("is validated: the box must fit the axis, the mode is uniform and nothing about the shape is kept", () => {
    const ok = {
      name: "lat",
      type: "float",
      coordinate: "lat",
      mode: "uniform",
      min: 40.5,
      max: 41.2,
      decimals: 5,
    };
    const first = validateSpec(spec(ok));
    if (!first.ok) throw new Error(JSON.stringify(first.problems));
    expect(first.ok).toBe(true);
    expect(validateSpec(spec({ ...ok, min: -95 })).ok).toBe(false);
    expect(validateSpec(spec({ ...ok, mode: "match_mean_sd", mean: 41, sd: 0.1 })).ok).toBe(false);
    expect(validateSpec(spec({ ...ok, mean: 40.9 })).ok).toBe(false);
    expect(
      validateSpec(
        spec({ ...ok, quantiles: Array.from({ length: 101 }, (_, i) => 40.5 + i * 0.007) }),
      ).ok,
    ).toBe(false);
    expect(validateSpec(spec({ ...ok, decimals: 9 })).ok).toBe(false);
    expect(
      validateSpec(spec({ name: "c", type: "categorical", counts: { a: 600 }, coordinate: "lat" }))
        .ok,
    ).toBe(false);
  });

  it("makes values inside the box with the decimals, spread evenly", () => {
    const s = spec(columnSpecOf(lat));
    const text = new TextDecoder().decode(renderAll(planTable(s, 3)));
    const values = text.trim().split("\n").slice(1).map(Number);
    expect(values).toHaveLength(600);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(40.51);
    expect(Math.max(...values)).toBeLessThanOrEqual(41.19);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(40.82); // the real mean was 40.8; an even spread centres on 40.85
    expect(mean).toBeLessThan(40.88);
    expect(text.split("\n")[1].split(".")[1].length).toBeLessThanOrEqual(5);
  });

  it("reads in the README as a box", () => {
    const text = agentReadme(spec(columnSpecOf(lat)), {
      fakeFileName: "t_fake.csv",
      seed: 3,
      appVersion: "0.4.0",
    });
    expect(text).toContain(
      "latitude inside the box 40.51 to 41.19, 5 decimal places, spread evenly",
    );
  });
});
