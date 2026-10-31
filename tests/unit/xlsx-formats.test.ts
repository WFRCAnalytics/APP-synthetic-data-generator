// Number format codes (specs/003 FR-006, research R5): what kind of cell a format code describes, how
// many decimals it shows, whether it has a thousands separator, and the codes behind the built-in ids.

import { describe, expect, it } from "vitest";
import { builtInFormat, describeFormat } from "../../src/lib/xlsx/formats";

const kind = (code: string) => describeFormat(code).kind;

describe("kinds", () => {
  it.each([
    ["General", "general"],
    ["", "general"],
    ["0", "number"],
    ["0.00", "number"],
    ["#,##0", "number"],
    ["#,##0.00", "number"],
    ["#,##0.00;[Red](#,##0.00)", "number"],
    ["0.0%", "percent"],
    ["0%", "percent"],
    ["$#,##0.00", "currency"],
    ['"€"#,##0.00', "currency"],
    ["[$£-809]#,##0.00", "currency"],
    ["#,##0.00 [$€-407]", "currency"],
    ["0.00E+00", "scientific"],
    ["##0.0E+0", "scientific"],
    ["@", "text"],
    ["mm/dd/yyyy", "date"],
    ["m/d/yy", "date"],
    ["yyyy-mm-dd", "date"],
    ["d-mmm-yy", "date"],
    ["dddd, mmmm d, yyyy", "date"],
    ["[$-409]mmmm d, yyyy;@", "date"],
    ["hh:mm:ss", "time"],
    ["h:mm AM/PM", "time"],
    ["[h]:mm:ss", "time"],
    ["mm:ss", "time"],
    ["yyyy-mm-dd hh:mm", "datetime"],
    ["m/d/yy h:mm", "datetime"],
    ["yyyy-mm-dd hh:mm:ss", "datetime"],
  ])("%j is %s", (code, expected) => {
    expect(kind(code)).toBe(expected);
  });

  it("ignores letters inside quotes and after a backslash", () => {
    expect(kind('0.00" days"')).toBe("number");
    expect(kind('0 "year(s)"')).toBe("number");
    expect(kind("0.0\\m")).toBe("number");
    expect(kind('"Date: "yyyy-mm-dd')).toBe("date");
  });

  it("reads m as minutes next to h or s and as month otherwise", () => {
    expect(kind("h:mm")).toBe("time");
    expect(kind("mm:ss")).toBe("time");
    expect(kind("mm/dd")).toBe("date");
    expect(kind("mmm")).toBe("date");
  });
});

describe("decimals and thousands", () => {
  it.each([
    ["0", 0, false],
    ["0.00", 2, false],
    ["#,##0", 0, true],
    ["#,##0.00", 2, true],
    ["#,##0.000;(#,##0.000)", 3, true],
    ["0.0%", 1, false],
    ["0%", 0, false],
    ["$#,##0.00", 2, true],
    ["0.00E+00", 2, false],
    ["##0.0E+0", 1, false],
    ["0.00_);(0.00)", 2, false],
    ["#,##0.00 [$€-407]", 2, true],
  ])("%j shows %i decimals, thousands %s", (code, decimals, thousands) => {
    const f = describeFormat(code);
    expect(f.decimals).toBe(decimals);
    expect(f.thousands).toBe(thousands);
  });

  it("has no fixed decimals for general, dates and text", () => {
    for (const code of ["General", "mm/dd/yyyy", "hh:mm", "@"]) expect(describeFormat(code).decimals).toBeNull();
  });
});

describe("built-in format ids", () => {
  it.each([
    [0, "General"],
    [1, "0"],
    [2, "0.00"],
    [3, "#,##0"],
    [4, "#,##0.00"],
    [9, "0%"],
    [10, "0.00%"],
    [11, "0.00E+00"],
    [14, "mm-dd-yy"],
    [15, "d-mmm-yy"],
    [18, "h:mm AM/PM"],
    [21, "h:mm:ss"],
    [22, "m/d/yy h:mm"],
    [37, "#,##0 ;(#,##0)"],
    [49, "@"],
  ])("id %i is %j", (id, code) => {
    expect(builtInFormat(id)).toBe(code);
  });

  it("has a code for every id from 0 to 49 that Excel defines, and none for custom ids", () => {
    const defined = [...Array(50).keys()].filter((i) => builtInFormat(i) !== null);
    expect(defined.length).toBeGreaterThanOrEqual(35);
    expect(builtInFormat(164)).toBeNull();
    expect(builtInFormat(-1)).toBeNull();
  });

  it("classifies the built-in codes sensibly", () => {
    expect(kind(builtInFormat(14) as string)).toBe("date");
    expect(kind(builtInFormat(19) as string)).toBe("time");
    expect(kind(builtInFormat(22) as string)).toBe("datetime");
    expect(kind(builtInFormat(10) as string)).toBe("percent");
    expect(kind(builtInFormat(11) as string)).toBe("scientific");
    expect(kind(builtInFormat(49) as string)).toBe("text");
  });
});
