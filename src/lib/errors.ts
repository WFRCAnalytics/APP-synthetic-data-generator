// Errors that can never carry a real cell value (constitution Principle I, FR-003).
//
// DuckDB error messages routinely quote the offending value ("Could not convert string 'jane@x.com'
// to INT32"). Raw engine messages must therefore never reach the UI, a log or a worker message.
// Every user-visible error is built here from a fixed code plus, at most, a column name and a row
// number (both structural, neither a cell value).

export type ErrorCode =
  | "csv_parse_error"
  | "conversion_error"
  | "out_of_memory"
  | "unsupported_encoding"
  | "file_empty"
  | "file_unreadable"
  | "cancelled"
  | "spec_invalid"
  | "generation_error"
  | "engine_error"
  | "extension_unavailable"
  | "xlsx_damaged"
  | "xlsx_legacy"
  | "xlsx_encrypted"
  | "xlsx_not_workbook"
  | "xlsx_sheet_missing"
  | "xlsx_range_invalid"
  | "xlsx_too_large"
  | "internal_error";

export interface ErrorContext {
  column?: string;
  /** A 1-based row number; digits only. */
  row?: number;
}

const near = (row?: number) => (row !== undefined ? ` near row ${row}` : "");
const inColumn = (column?: string) => (column !== undefined ? ` in column "${column}"` : "");

/** The fixed, safe message for a code. */
export function describeError(code: ErrorCode, ctx: ErrorContext = {}): string {
  switch (code) {
    case "csv_parse_error":
      return `The file could not be read as CSV${near(ctx.row)}. Check the delimiter, quote and header settings.`;
    case "conversion_error":
      return `A value${inColumn(ctx.column)}${near(ctx.row)} could not be converted.`;
    case "out_of_memory":
      return "The browser ran out of memory. Try a smaller file or close other tabs.";
    case "unsupported_encoding":
      return "This file's text encoding is not supported yet.";
    case "file_empty":
      return "The file is empty.";
    case "file_unreadable":
      return "The file could not be opened.";
    case "cancelled":
      return "The operation was cancelled.";
    case "spec_invalid":
      return "The spec has problems. Go back to Review to fix them.";
    case "generation_error":
      return "The table could not be generated from this spec.";
    case "engine_error":
      return "Something went wrong while processing the file.";
    case "extension_unavailable":
      return "The Excel reader could not be loaded. Reload the page and try again.";
    case "xlsx_damaged":
      return "This workbook is damaged and cannot be read. Open it in Excel and save it again, then retry.";
    case "xlsx_legacy":
      return "This is an old Excel file (.xls). Open it in Excel and save it as .xlsx, then retry.";
    case "xlsx_encrypted":
      return "This workbook is password protected. Remove the password in Excel, save it, then retry.";
    case "xlsx_not_workbook":
      return "This file is not an Excel workbook (.xlsx).";
    case "xlsx_sheet_missing":
      return "The workbook has no sheet with that name.";
    case "xlsx_range_invalid":
      return "The cell range is not valid. Use a range such as A3:I203.";
    case "xlsx_too_large":
      return "This workbook is too large to open in the browser.";
    case "internal_error":
      return "An unexpected error occurred.";
  }
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly column?: string;
  readonly row?: number;

  constructor(code: ErrorCode, ctx: ErrorContext = {}) {
    super(describeError(code, ctx));
    this.name = "AppError";
    this.code = code;
    this.column = ctx.column;
    this.row = ctx.row;
  }
}

/** A plain, structured-clone-safe form for posting across the worker boundary. */
export interface WireError {
  code: ErrorCode;
  message: string;
}

export function toWireError(err: AppError): WireError {
  return { code: err.code, message: err.message };
}

// Pulls a row number out of an engine message: digits only, so no value can come with it.
function rowFrom(message: string): number | undefined {
  const m = /\b(?:line|row)[:\s#]*(\d{1,12})\b/i.exec(message);
  return m ? Number(m[1]) : undefined;
}

/**
 * Converts any thrown value into a safe AppError. The original message is read only to choose a
 * code and a row number; none of its text is copied into the result.
 */
export function sanitizeError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  // A workbook problem already carries one of the fixed codes (see src/lib/xlsx/metadata.ts).
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  if (typeof code === "string" && code.startsWith("xlsx_")) return new AppError(code as ErrorCode);
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";

  if (/out of memory|memory limit|allocation failed|RangeError: Array buffer/i.test(raw)) {
    return new AppError("out_of_memory");
  }
  if (/conversion error|could not convert|cast/i.test(raw)) {
    return new AppError("conversion_error", { row: rowFrom(raw) });
  }
  if (/csv error|error when sniffing|could not parse|invalid unicode|invalid input error/i.test(raw)) {
    return new AppError("csv_parse_error", { row: rowFrom(raw) });
  }
  if (/encoding/i.test(raw)) return new AppError("unsupported_encoding");
  if (/abort|cancel/i.test(raw)) return new AppError("cancelled");
  return new AppError(raw ? "engine_error" : "internal_error");
}
