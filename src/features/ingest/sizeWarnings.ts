// When to warn about a large file (FR-034), apart from how the warning looks.

import type { Encoding } from "../../lib/encoding/detect";

export const LARGE_FILE_BYTES = 100 * 1024 * 1024;
export const HUGE_FILE_BYTES = 500 * 1024 * 1024;

const mb = (bytes: number) => Math.round(bytes / 1048576).toLocaleString("en-US");

/**
 * Messages for a sheet of this expanded size (the size of its data once opened, from the workbook's own
 * directory). A workbook expands many times in memory, so the warning counts the expanded data, not the file.
 */
export function workbookSizeWarnings(expandedBytes: number): string[] {
  if (expandedBytes < LARGE_FILE_BYTES) return [];
  const need = mb(expandedBytes * 2.5);
  return [`This sheet holds about ${mb(expandedBytes)} MB of data once opened, and needs roughly ${need} MB of memory to read and profile. Close other heavy tabs first; progress is shown, and you can cancel.`];
}

/** Messages to show for a file of this size and encoding; none for a small UTF-8 or UTF-16LE file. */
export function sizeWarnings(fileSize: number, encoding: Encoding | undefined): string[] {
  const out: string[] = [];
  if (fileSize >= HUGE_FILE_BYTES) {
    out.push(`This file is ${mb(fileSize)} MB, at or above the size this app is built for. Profiling can take several minutes and needs a lot of memory; close other heavy tabs first.`);
  } else if (fileSize >= LARGE_FILE_BYTES) {
    out.push(`This file is ${mb(fileSize)} MB. Profiling may take a few minutes; the page stays usable and shows progress.`);
  }
  if (fileSize >= LARGE_FILE_BYTES && (encoding === "utf-16be" || encoding === "windows-1252")) {
    out.push(`This encoding is converted in memory before it is read, so about ${mb(fileSize * 2)} MB of memory is needed, twice the file size.`);
  }
  return out;
}
