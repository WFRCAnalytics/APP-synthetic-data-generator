// @vitest-environment node
// Designed tables whose ID column uses another table's IDs (specs/027): the rows are shared out among the IDs within the range the
// person gives, every ID exists in the other table, and a range or a table that cannot fit is refused with the reason.
import { describe, expect, it } from "vitest";
import { specFromDesign } from "../../src/lib/design/build";
import { defaultColumn, emptyDesign } from "../../src/lib/design/defaults";
import { repeatForRange } from "../../src/lib/design/repeat";
import type { Design, DesignColumn, DesignId } from "../../src/lib/design/types";
import { validateDesign } from "../../src/lib/design/validate";
import { planTable, rowValues } from "../../src/lib/generate/table";
import { linkTo } from "../../src/lib/ids/link";
import { SPEC_VERSION, type SpecFile, type SurveyIdColumn } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";

const total = (r: Record<string, number>) => Object.entries(r).reduce((a, [size, n]) => a + Number(size) * n, 0);
const groups = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe("repeatForRange", () => {
  it("shares the rows out among IDs within the range, spread across it", () => {
    for (const [rows, min, max] of [[300, 1, 4], [1000, 2, 6], [99, 1, 1], [57, 3, 3], [10, 1, 10]] as const) {
      const r = repeatForRange(rows, min, max)!;
      expect(total(r)).toBe(rows);
      for (const size of Object.keys(r)) {
        expect(Number(size)).toBeGreaterThanOrEqual(min);
        expect(Number(size)).toBeLessThanOrEqual(max);
      }
    }
    expect(Object.keys(repeatForRange(300, 1, 4)!).length).toBe(4); // every size in the range is used
  });
  it("is null when the rows cannot be shared out that way", () => {
    expect(repeatForRange(7, 5, 6)).toBeNull();
    expect(repeatForRange(0, 1, 2)).toBeNull();
    expect(repeatForRange(10, 3, 2)).toBeNull();
    expect(repeatForRange(10, 0, 2)).toBeNull();
  });
});

const parent: SpecFile = {
  spec_version: SPEC_VERSION,
  source: { format: "csv", file_name: "households.csv", encoding: "utf-8", delimiter: ",", quote: '"', quote_style: "minimal", line_ending: "lf", trailing_newline: true, header: true },
  n_rows: 120,
  seed: 5,
  columns: [{ name: "hh_id", type: "survey_id", mask: ["upper", "digit", "digit", "digit"], repeat_structure: { "1": 120 } }],
};
const link = linkTo(parent, parent.columns[0] as SurveyIdColumn);

function design(over: Partial<DesignId>, rows = 300): Design {
  const taken: string[] = [];
  const id = { ...defaultColumn("id", taken), name: "hh_id", link, perIdMin: 1, perIdMax: 4, ...over } as DesignId;
  taken.push(id.name);
  const age = { ...defaultColumn("integer", taken), name: "age", min: 0, max: 90 } as DesignColumn;
  return { ...emptyDesign(), tableName: "persons", rows, seed: 9, columns: [id, age] };
}

describe("a designed table with linked IDs", () => {
  it("becomes a valid spec whose IDs all exist in the other table", () => {
    const result = specFromDesign(design({}));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateSpec(JSON.parse(JSON.stringify(result.spec))).ok).toBe(true);
    const col = result.spec.columns[0] as SurveyIdColumn;
    expect(col.link).toEqual(link);
    expect(total(col.repeat_structure)).toBe(300);
    expect(groups(col.repeat_structure)).toBeLessThanOrEqual(120);

    const parentPlan = planTable(parent, 5);
    const parentIds = new Set(Array.from({ length: 120 }, (_, r) => rowValues(parentPlan, r)[0]));
    const plan = planTable(result.spec, 9);
    for (let r = 0; r < 300; r++) expect(parentIds.has(rowValues(plan, r)[0])).toBe(true);
  });

  it("is refused when the rows cannot be shared out within the range, or need more IDs than the other table has", () => {
    expect(validateDesign(design({ perIdMin: 5, perIdMax: 6 }, 7)).some((p) => p.field === "perIdMax")).toBe(true);
    expect(validateDesign(design({ perIdMin: 1, perIdMax: 1 }, 300)).some((p) => p.field === "perIdMin")).toBe(true); // 300 IDs from 120
    expect(validateDesign(design({ perIdMin: 0 })).some((p) => p.field === "perIdMin")).toBe(true);
    expect(validateDesign(design({})).filter((p) => p.columnId !== null)).toEqual([]);
  });
});
