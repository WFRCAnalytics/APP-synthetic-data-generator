// Loading DuckDB extensions from the site itself (specs/003 research R2).

import { AppError } from "../errors";

/**
 * Loads the Excel extension from the site's own folder (specs/003 research R2). `repositoryUrl` is the
 * absolute address of `public/duckdb-ext/`; the engine then fetches
 * `<repository>/<engine version>/<platform>/excel.duckdb_extension.wasm` from there and nowhere else.
 * `autoinstall` and `autoload` stay off. `run` is any function that runs one SQL statement.
 */
export async function loadExcelExtension(run: (sql: string) => Promise<unknown>, repositoryUrl: string): Promise<void> {
  const escaped = repositoryUrl.replace(/'/g, "''");
  try {
    await run(`SET custom_extension_repository = '${escaped}'`);
    await run("SET autoinstall_known_extensions = false");
    await run("SET autoload_known_extensions = false");
    await run("LOAD excel");
  } catch {
    // The engine's message is not shown: it can name paths, and the cause (a missing file) is the same for the user.
    throw new AppError("extension_unavailable");
  }
}
