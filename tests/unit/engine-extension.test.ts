// Loading the Excel extension from the site (specs/003 FR-016, research R2): which statements are run,
// that nothing is auto-installed, and that a failure becomes a fixed message with no engine text.

import { describe, expect, it } from "vitest";
import { AppError } from "../../src/lib/errors";
import { loadExcelExtension } from "../../src/lib/duckdb/extension";

const REPO = "https://example.test/APP-synthetic-data-generator/duckdb-ext";

describe("loadExcelExtension", () => {
  it("points the engine at the site's own folder, keeps auto-install off, then loads excel", async () => {
    const run: string[] = [];
    await loadExcelExtension(async (sql) => void run.push(sql), REPO);
    expect(run).toEqual([`SET custom_extension_repository = '${REPO}'`, "SET autoinstall_known_extensions = false", "SET autoload_known_extensions = false", "LOAD excel"]);
  });

  it("sets the repository before loading, so nothing is fetched from the default host", async () => {
    const run: string[] = [];
    await loadExcelExtension(async (sql) => void run.push(sql), REPO);
    expect(run.findIndex((s) => s.startsWith("SET custom_extension_repository"))).toBeLessThan(run.indexOf("LOAD excel"));
    expect(run.join(" ")).not.toMatch(/extensions\.duckdb\.org/);
  });

  it("escapes a quote in the address", async () => {
    const run: string[] = [];
    await loadExcelExtension(async (sql) => void run.push(sql), "https://x.test/it's");
    expect(run[0]).toBe("SET custom_extension_repository = 'https://x.test/it''s'");
  });

  it("turns any failure into the fixed message, without the engine's text", async () => {
    const failing = async (sql: string) => {
      if (sql === "LOAD excel") throw new Error("IO Error: Cannot open file /secret/path/to/Jane Doe.xlsx: HTTP 404");
    };
    const error = await loadExcelExtension(failing, REPO).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("extension_unavailable");
    expect((error as AppError).message).not.toMatch(/secret|Jane|404|\/path/);
  });
});
