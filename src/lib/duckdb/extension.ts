// Loading DuckDB extensions from the site itself (specs/003 research R2).

import { AppError } from "../errors";

/** The extensions the app loads from its own folder. */
export type SiteExtension = "excel" | "parquet";

/**
 * Loads an extension from the site's own folder (specs/003 research R2, specs/005 research R1).
 * `repositoryUrl` is the absolute address of `public/duckdb-ext/`; the engine then fetches
 * `<repository>/<engine version>/<platform>/<name>.duckdb_extension.wasm` from there and nowhere else.
 * `autoinstall` and `autoload` stay off. `run` is any function that runs one SQL statement.
 */
export async function loadExtension(run: (sql: string) => Promise<unknown>, repositoryUrl: string, name: SiteExtension): Promise<void> {
  const escaped = repositoryUrl.replace(/'/g, "''");
  try {
    await run(`SET custom_extension_repository = '${escaped}'`);
    await run("SET autoinstall_known_extensions = false");
    await run("SET autoload_known_extensions = false");
    await run(`LOAD ${name}`);
  } catch {
    // The engine's message is not shown: it can name paths, and the cause (a missing file) is the same for the user.
    throw new AppError("extension_unavailable");
  }
}

/** The Excel reader (specs/003). */
export const loadExcelExtension = (run: (sql: string) => Promise<unknown>, repositoryUrl: string): Promise<void> => loadExtension(run, repositoryUrl, "excel");

/** The Parquet reader (specs/005). */
export const loadParquetExtension = (run: (sql: string) => Promise<unknown>, repositoryUrl: string): Promise<void> => loadExtension(run, repositoryUrl, "parquet");
