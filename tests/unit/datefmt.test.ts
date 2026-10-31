import { describe, expect, it } from "vitest";
import {
  formatDate,
  fromNumber,
  isSupportedPattern,
  parseDate,
  patternGranularity,
  patternKind,
  toDuckdbPattern,
  toNumber,
} from "../../src/lib/datefmt/directives";

const sample = new Date(Date.UTC(2024, 2, 4, 8, 15, 42)); // 2024-03-04 08:15:42

describe("supported patterns", () => {
  it.each(["%Y-%m-%d", "%m/%d/%Y", "%d-%b-%Y", "%Y-%m-%dT%H:%M:%S", "%I:%M %p", "%H%M", "%B %d, %Y", "%j"])(
    "accepts %s",
    (p) => {
      expect(isSupportedPattern(p)).toBe(true);
    },
  );

  it.each(["", "no directives", "%A", "%Z", "%z", "%f", "%", "%Y-%q", "%%"])("rejects %j", (p) => {
    expect(isSupportedPattern(p)).toBe(false);
  });

  it("toDuckdbPattern passes supported patterns through and throws otherwise", () => {
    expect(toDuckdbPattern("%Y-%m-%d")).toBe("%Y-%m-%d");
    expect(() => toDuckdbPattern("%Z")).toThrow(RangeError);
  });
});

describe("kind and granularity", () => {
  it("classifies patterns", () => {
    expect(patternKind("%Y-%m-%d")).toBe("date");
    expect(patternKind("%H:%M")).toBe("time");
    expect(patternKind("%H%M")).toBe("time");
    expect(patternKind("%Y-%m-%d %H:%M:%S")).toBe("datetime");
    expect(patternKind("%m/%d/%Y %I:%M:%S %p")).toBe("datetime");
  });

  it("finds the finest unit", () => {
    expect(patternGranularity("%Y-%m-%d")).toBe("day");
    expect(patternGranularity("%H:%M")).toBe("minute");
    expect(patternGranularity("%H%M")).toBe("minute");
    expect(patternGranularity("%H:%M:%S")).toBe("second");
  });
});

describe("format and parse", () => {
  it("formats the zoo patterns exactly", () => {
    expect(formatDate(sample, "%Y-%m-%d")).toBe("2024-03-04");
    expect(formatDate(sample, "%m/%d/%Y")).toBe("03/04/2024");
    expect(formatDate(sample, "%d/%m/%Y")).toBe("04/03/2024");
    expect(formatDate(sample, "%d-%b-%Y")).toBe("04-Mar-2024");
    expect(formatDate(sample, "%Y-%m-%dT%H:%M:%S")).toBe("2024-03-04T08:15:42");
    expect(formatDate(sample, "%Y-%m-%d %H:%M:%S")).toBe("2024-03-04 08:15:42");
    expect(formatDate(sample, "%m/%d/%Y %I:%M:%S %p")).toBe("03/04/2024 08:15:42 AM");
    expect(formatDate(sample, "%H%M")).toBe("0815");
    expect(formatDate(sample, "%H:%M")).toBe("08:15");
    expect(formatDate(sample, "%B %d, %Y")).toBe("March 04, 2024");
    expect(formatDate(sample, "%j")).toBe("064"); // 2024 is a leap year: Jan 31 + Feb 29 + 4
  });

  it("round trips through parse for every zoo pattern", () => {
    for (const p of ["%Y-%m-%d", "%m/%d/%Y", "%d-%b-%Y", "%Y-%m-%dT%H:%M:%S", "%m/%d/%Y %I:%M:%S %p"]) {
      const text = formatDate(sample, p);
      const parsed = parseDate(text, p);
      expect(parsed).not.toBeNull();
      expect(formatDate(parsed as Date, p)).toBe(text);
    }
  });

  it("handles 12-hour clock edges", () => {
    const midnight = new Date(Date.UTC(2024, 0, 1, 0, 5, 0));
    const noon = new Date(Date.UTC(2024, 0, 1, 12, 5, 0));
    expect(formatDate(midnight, "%I:%M %p")).toBe("12:05 AM");
    expect(formatDate(noon, "%I:%M %p")).toBe("12:05 PM");
    expect(parseDate("12:05 AM", "%I:%M %p")?.getUTCHours()).toBe(0);
    expect(parseDate("12:05 PM", "%I:%M %p")?.getUTCHours()).toBe(12);
    expect(parseDate("01:30 PM", "%I:%M %p")?.getUTCHours()).toBe(13);
  });

  it("accepts a leap day and rejects impossible dates", () => {
    expect(parseDate("2024-02-29", "%Y-%m-%d")).not.toBeNull();
    expect(parseDate("2023-02-29", "%Y-%m-%d")).toBeNull();
    expect(parseDate("2024-02-30", "%Y-%m-%d")).toBeNull();
    expect(parseDate("2024-13-01", "%Y-%m-%d")).toBeNull();
    expect(parseDate("00/00/0000", "%m/%d/%Y")).toBeNull();
  });

  it("rejects text that does not fit the pattern", () => {
    expect(parseDate("2024/03/04", "%Y-%m-%d")).toBeNull();
    expect(parseDate("not a date", "%Y-%m-%d")).toBeNull();
    expect(parseDate("25:00", "%H:%M")).toBeNull();
    expect(parseDate("08:61", "%H:%M")).toBeNull();
  });

  it("parses time-only patterns onto 1970-01-01", () => {
    const t = parseDate("0815", "%H%M") as Date;
    expect(t.getUTCFullYear()).toBe(1970);
    expect(t.getUTCHours()).toBe(8);
    expect(t.getUTCMinutes()).toBe(15);
  });

  it("parses day of year and month names", () => {
    expect(parseDate("064 2024", "%j %Y")?.getUTCMonth()).toBe(2);
    expect(parseDate("366 2023", "%j %Y")).toBeNull();
    expect(parseDate("04-mar-2024", "%d-%b-%Y")?.getUTCMonth()).toBe(2);
    expect(parseDate("March 04, 2024", "%B %d, %Y")?.getUTCDate()).toBe(4);
  });

  it("uses the POSIX pivot for two-digit years", () => {
    expect(parseDate("68-01-01", "%y-%m-%d")?.getUTCFullYear()).toBe(2068);
    expect(parseDate("69-01-01", "%y-%m-%d")?.getUTCFullYear()).toBe(1969);
  });

  it("throws on an unsupported pattern when formatting", () => {
    expect(() => formatDate(sample, "%Z")).toThrow(RangeError);
  });
});

describe("numeric conversion", () => {
  it("converts dates to days and back", () => {
    const n = toNumber(sample, "date");
    expect(n).toBe(19786);
    expect(formatDate(fromNumber(n, "date"), "%Y-%m-%d")).toBe("2024-03-04");
  });

  it("converts datetimes to seconds and back", () => {
    const n = toNumber(sample, "datetime");
    expect(formatDate(fromNumber(n, "datetime"), "%Y-%m-%d %H:%M:%S")).toBe("2024-03-04 08:15:42");
  });

  it("converts times to seconds since midnight and back", () => {
    const n = toNumber(sample, "time");
    expect(n).toBe(8 * 3600 + 15 * 60 + 42);
    expect(formatDate(fromNumber(n, "time"), "%H:%M:%S")).toBe("08:15:42");
  });
});
