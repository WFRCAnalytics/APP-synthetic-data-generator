import { describe, expect, it } from "vitest";
import { AppError, describeError, sanitizeError, toWireError, type ErrorCode } from "../../src/lib/errors";

const SECRET_VALUES = ["jane.doe@example.com", "555-12-3456", "42 Wallaby Way", "Zürich-secret"];

function leaks(message: string): string[] {
  return SECRET_VALUES.filter((s) => message.includes(s));
}

describe("AppError messages", () => {
  const codes: ErrorCode[] = [
    "csv_parse_error",
    "conversion_error",
    "out_of_memory",
    "unsupported_encoding",
    "file_empty",
    "file_unreadable",
    "cancelled",
    "spec_invalid",
    "generation_error",
    "engine_error",
    "extension_unavailable",
    "parquet_not_parquet",
    "parquet_damaged",
    "parquet_empty",
    "parquet_encrypted",
    "parquet_too_large",
    "json_empty",
    "json_not_records",
    "json_malformed",
    "json_duplicate_key",
    "json_too_large",
    "json_unsupported_form",
    "internal_error",
  ];

  it.each(codes)("has a fixed message for %s", (code) => {
    expect(describeError(code).length).toBeGreaterThan(5);
  });

  it("includes a column name and row number only when given", () => {
    expect(describeError("conversion_error", { column: "mode", row: 17 })).toBe(
      'A value in column "mode" at row 17 could not be converted.'.replace("at row", "near row"),
    );
    expect(describeError("conversion_error")).toBe("A value could not be converted.");
  });

  it("carries the code, column and row as fields", () => {
    const err = new AppError("csv_parse_error", { row: 5 });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("csv_parse_error");
    expect(err.row).toBe(5);
    expect(err.message).toContain("row 5");
  });

  it("converts to a plain wire form", () => {
    const wire = toWireError(new AppError("file_empty"));
    expect(wire).toEqual({ code: "file_empty", message: "The file is empty." });
  });
});

describe("Parquet errors", () => {
  it("says what is wrong in fixed words, none of them from the file", () => {
    expect(describeError("parquet_not_parquet")).toBe("This file is not a Parquet file.");
    expect(describeError("parquet_damaged")).toMatch(/damaged or incomplete/);
    expect(describeError("parquet_empty")).toMatch(/no rows or no columns/);
    expect(describeError("parquet_encrypted")).toMatch(/encrypted/);
    expect(describeError("parquet_too_large")).toMatch(/too large/);
  });

  it("keeps the code of an error that already has one", () => {
    expect(sanitizeError({ code: "parquet_empty" }).code).toBe("parquet_empty");
    expect(sanitizeError({ code: "parquet_encrypted", message: "PRIVATE-MARKER" }).message).not.toContain("PRIVATE-MARKER");
  });

  it("turns the engine's reply to a cut-short file into the fixed message, without the file name", () => {
    const err = sanitizeError(new Error("Invalid Input Error: No magic bytes found at end of file 'Jane Doe survey.parquet'\n\nLINE 1: SELECT"));
    expect(err.code).toBe("parquet_damaged");
    expect(err.message).not.toMatch(/Jane|survey|LINE/);
  });

  it("names the reader generically when an extension cannot load", () => {
    expect(describeError("extension_unavailable")).toBe("The reader for this kind of file could not be loaded. Reload the page and try again.");
  });
});

describe("sanitizeError never leaks a value", () => {
  const engineMessages = [
    "Conversion Error: Could not convert string 'jane.doe@example.com' to INT32 in column \"mode\", at line 42",
    "Invalid Input Error: CSV Error on Line: 17\nPossible Solution: ... value 'Zürich-secret' ...",
    "Error when sniffing file. The row '555-12-3456,42 Wallaby Way' has 2 columns",
    "Out of Memory Error: could not allocate block of size 262.1 KiB (3.7 GiB/3.7 GiB used)",
    "Could not parse '42 Wallaby Way' as a date",
    "Some totally unexpected engine failure mentioning jane.doe@example.com",
  ];

  it.each(engineMessages)("scrubs %#", (raw) => {
    const err = sanitizeError(new Error(raw));
    expect(leaks(err.message)).toEqual([]);
    expect(leaks(JSON.stringify(toWireError(err)))).toEqual([]);
  });

  it("maps each kind of engine failure to the right code", () => {
    expect(sanitizeError(new Error(engineMessages[0])).code).toBe("conversion_error");
    expect(sanitizeError(new Error(engineMessages[1])).code).toBe("csv_parse_error");
    expect(sanitizeError(new Error(engineMessages[2])).code).toBe("csv_parse_error");
    expect(sanitizeError(new Error(engineMessages[3])).code).toBe("out_of_memory");
    expect(sanitizeError(new Error(engineMessages[5])).code).toBe("engine_error");
  });

  it("keeps a row number but nothing around it", () => {
    const err = sanitizeError(new Error(engineMessages[0]));
    expect(err.row).toBe(42);
    expect(err.message).toContain("row 42");
  });

  it("passes AppErrors through unchanged", () => {
    const original = new AppError("file_empty");
    expect(sanitizeError(original)).toBe(original);
  });

  it("handles non-Error values", () => {
    expect(sanitizeError("a string with jane.doe@example.com").code).toBe("engine_error");
    expect(leaks(sanitizeError("a string with jane.doe@example.com").message)).toEqual([]);
    expect(sanitizeError(undefined).code).toBe("internal_error");
    expect(sanitizeError({ weird: true }).code).toBe("internal_error");
  });

  it("recognizes cancellation", () => {
    expect(sanitizeError(new Error("The operation was aborted")).code).toBe("cancelled");
  });
});

describe("JSON errors", () => {
  it("say what is wrong in fixed words, none of them from the file or the engine", () => {
    expect(describeError("json_empty")).toMatch(/no records or no keys/);
    expect(describeError("json_not_records")).toMatch(/list of records/);
    expect(describeError("json_malformed")).toMatch(/not plain JSON/);
    expect(describeError("json_duplicate_key")).toMatch(/repeats a key/);
    expect(describeError("json_too_large")).toMatch(/too large/);
    expect(describeError("json_unsupported_form")).toMatch(/GeoJSON/);
  });

  it("keeps a code from the worker and drops any other message", () => {
    const wire = { code: "json_malformed", message: "Malformed JSON in file \"a.json\", first character is '{' SECRET" };
    expect(sanitizeError(wire).message).not.toContain("SECRET");
    expect(sanitizeError(wire).code).toBe("json_malformed");
  });
});
