import { describe, expect, it } from "vitest";
import { formatCheckValue } from "../../src/features/generate/checkFormat";

describe("formatCheckValue", () => {
  it("leaves plain values as they are", () => {
    expect(formatCheckValue("80")).toBe("80");
    expect(formatCheckValue("63215.030675")).toBe("63215.030675");
    expect(formatCheckValue("")).toBe("");
  });

  it("reads a count per label as label: count", () => {
    expect(formatCheckValue('{"bus":80,"car":200}')).toBe("bus: 80, car: 200");
    expect(formatCheckValue('{"5":80}')).toBe("5: 80");
  });

  it("names an empty label and adds thousands separators", () => {
    expect(formatCheckValue('{"":1200,"x":3}')).toBe("(blank): 1,200, x: 3");
  });

  it("shortens a long list", () => {
    const text = JSON.stringify(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i])));
    expect(formatCheckValue(text)).toBe("k0: 0, k1: 1, k2: 2, k3: 3 and 5 more");
  });

  it("leaves text that is not an object of counts alone", () => {
    expect(formatCheckValue("{broken")).toBe("{broken");
    expect(formatCheckValue("[1,2]")).toBe("[1,2]");
    expect(formatCheckValue("{}")).toBe("{}");
  });
});
