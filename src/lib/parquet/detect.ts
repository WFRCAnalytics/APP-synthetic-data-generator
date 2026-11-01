// Telling a Parquet file from anything else by its content (specs/005 FR-001, FR-015, research R9): a Parquet
// file starts and ends with the four bytes PAR1; one with an encrypted footer starts and ends with PARE.
// The name of the file is never consulted.

export type ParquetKindOfFile = "parquet" | "encrypted" | "damaged" | "not_parquet";

const text = (bytes: Uint8Array): string => String.fromCharCode(...bytes.subarray(0, 4));

/**
 * @param head the first bytes of the file (at least four, or fewer for a tiny file)
 * @param tail the last bytes of the file
 */
export function classifyParquet(head: Uint8Array, tail: Uint8Array): ParquetKindOfFile {
  if (head.length < 4) return "not_parquet";
  const start = text(head);
  const end = tail.length >= 4 ? text(tail.subarray(tail.length - 4)) : "";
  if (start === "PARE") return "encrypted";
  if (start !== "PAR1") return "not_parquet";
  // A file that begins like Parquet but does not end like it was cut short or written badly.
  if (end === "PARE") return "encrypted";
  return end === "PAR1" ? "parquet" : "damaged";
}

/** A quick test for the file chooser: does this look like a Parquet file by its first bytes? */
export const startsLikeParquet = (head: Uint8Array): boolean => head.length >= 4 && (text(head) === "PAR1" || text(head) === "PARE");
