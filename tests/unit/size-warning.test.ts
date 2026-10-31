// FR-034: a heads-up before a large file is profiled, including the extra memory some encodings need.

import { describe, expect, it } from "vitest";
import { HUGE_FILE_BYTES, LARGE_FILE_BYTES, sizeWarnings } from "../../src/features/ingest/sizeWarnings";

const MB = 1024 * 1024;

describe("sizeWarnings", () => {
  it("says nothing for a small file", () => {
    expect(sizeWarnings(5 * MB, "utf-8")).toEqual([]);
    expect(sizeWarnings(LARGE_FILE_BYTES - 1, "windows-1252")).toEqual([]);
  });

  it("warns about a large file and says it shows progress", () => {
    const w = sizeWarnings(250 * MB, "utf-8");
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/250 MB/);
    expect(w[0]).toMatch(/progress/);
  });

  it("warns more strongly at the size the app is built for", () => {
    const w = sizeWarnings(HUGE_FILE_BYTES, "utf-8");
    expect(w[0]).toMatch(/500 MB/);
    expect(w[0]).toMatch(/close other heavy tabs/i);
  });

  it("adds the memory note for encodings that are converted before reading", () => {
    for (const enc of ["utf-16be", "windows-1252"] as const) {
      const w = sizeWarnings(300 * MB, enc);
      expect(w).toHaveLength(2);
      expect(w[1]).toMatch(/600 MB of memory/);
    }
  });

  it("adds no memory note for encodings read as they are", () => {
    expect(sizeWarnings(300 * MB, "utf-8")).toHaveLength(1);
    expect(sizeWarnings(300 * MB, "utf-16le")).toHaveLength(1);
  });
});
