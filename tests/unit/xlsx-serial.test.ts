// Excel serial numbers (specs/003 FR-005, research R6): ISO date text to a serial number and back, in
// the 1900 and the 1904 date system, including the 1900 leap-year quirk.

import { describe, expect, it } from "vitest";
import { isoToSerial, serialToIso } from "../../src/lib/xlsx/serial";

describe("the 1900 date system", () => {
  it.each([
    ["1900-01-01", 1],
    ["1900-02-28", 59],
    ["1900-03-01", 61], // serial 60 is Excel's imaginary 1900-02-29
    ["1999-12-31", 36525],
    ["2000-01-01", 36526],
    ["2024-01-01", 45292],
    ["2024-02-29", 45351],
    ["2099-12-31", 73050],
  ])("%s is serial %i", (iso, serial) => {
    expect(isoToSerial(iso, false)).toBe(serial);
    expect(serialToIso(serial, false, "date")).toBe(iso);
  });

  it("has no real date for the imaginary 29 February 1900", () => {
    expect(serialToIso(60, false, "date")).toBeNull();
  });

  it("refuses dates before 1900 and serial 0", () => {
    expect(isoToSerial("1899-12-31", false)).toBeNull();
    expect(serialToIso(0, false, "date")).toBeNull();
    expect(serialToIso(-5, false, "date")).toBeNull();
  });
});

describe("the 1904 date system", () => {
  it.each([
    ["1904-01-01", 0],
    ["1904-01-02", 1],
    ["2024-01-01", 43830],
  ])("%s is serial %i", (iso, serial) => {
    expect(isoToSerial(iso, true)).toBe(serial);
    expect(serialToIso(serial, true, "date")).toBe(iso);
  });

  it("refuses dates before 1904", () => {
    expect(isoToSerial("1903-12-31", true)).toBeNull();
  });

  it("the two systems differ by 1462 days for the same date", () => {
    expect((isoToSerial("2020-06-15", false) as number) - (isoToSerial("2020-06-15", true) as number)).toBe(1462);
  });
});

describe("times of day", () => {
  it("makes the fraction of a day", () => {
    expect(isoToSerial("2024-01-01 12:00:00", false)).toBe(45292.5);
    expect(isoToSerial("2024-01-01 06:00:00", false)).toBe(45292.25);
    expect(isoToSerial("08:30:00", false)).toBeCloseTo(0.3541666667, 9);
  });

  it("round trips datetimes to the second", () => {
    for (const iso of ["2024-03-09 08:30:15", "2020-12-31 23:59:59", "2000-01-01 00:00:01", "1999-07-04 12:34:56"]) {
      const serial = isoToSerial(iso, false) as number;
      expect(serialToIso(serial, false, "datetime")).toBe(iso);
    }
  });

  it("round trips times to the second", () => {
    for (const t of ["00:00:00", "08:30:00", "13:45:59", "23:59:59"]) expect(serialToIso(isoToSerial(t, false) as number, false, "time")).toBe(t);
  });

  it("round trips datetimes in the 1904 system", () => {
    const serial = isoToSerial("2021-05-06 07:08:09", true) as number;
    expect(serialToIso(serial, true, "datetime")).toBe("2021-05-06 07:08:09");
  });
});

describe("text that is not a date", () => {
  it.each(["", "abc", "2024-13-01", "2024-02-30", "24-01-01", "2024-01-01T10:00:00", "10:61:00", "10:00"])("%j gives null", (text) => {
    expect(isoToSerial(text, false)).toBeNull();
  });
});
