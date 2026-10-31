// Prototype spikes for the VERIFY items in specs/001-csv-synthetic-slice/research.md (R1, R2, R9,
// R14). Driven by the Playwright specs in tests/e2e/spikes. Not part of the shipped app.

import { createEngine, duckdb, type Engine } from "../lib/duckdb/engine";

const BASE = `${import.meta.env.BASE_URL}duckdb/`;

const violations: string[] = [];
document.addEventListener("securitypolicyviolation", (e) => {
  violations.push(`${e.violatedDirective} ${e.blockedURI}`);
});

function inputFiles(): File[] {
  const input = document.getElementById("files") as HTMLInputElement;
  return Array.from(input.files ?? []);
}

function heapMb(): number | null {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? Math.round(mem.usedJSHeapSize / 1048576) : null;
}

async function scalar(conn: duckdb.AsyncDuckDBConnection, sql: string): Promise<unknown> {
  const table = await conn.query(sql);
  const row = table.get(0);
  return row ? Object.values(row.toJSON())[0] : null;
}

const spike = {
  /** R9: does DuckDB start and answer a query under the strict page CSP? */
  async csp() {
    const engine = await createEngine(BASE);
    const conn = await engine.db.connect();
    const answer = await scalar(conn, "SELECT 42");
    const version = await scalar(conn, "SELECT version()");
    await conn.close();
    await engine.dispose();
    return { answer: Number(answer), version: String(version), violations: [...violations] };
  },

  /** R1: can a large CSV be read straight from the File into an in-memory all-text table? */
  async memory() {
    const [file] = inputFiles();
    const started = performance.now();
    const engine: Engine = await createEngine(BASE);
    await engine.db.registerFileHandle(file.name, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
    const conn = await engine.db.connect();
    const heapBefore = heapMb();
    await conn.query(`CREATE TABLE src AS SELECT * FROM read_csv('${file.name}', all_varchar = true, header = true)`);
    const loadSeconds = (performance.now() - started) / 1000;
    const rows = Number(await scalar(conn, "SELECT count(*) FROM src"));
    const columns = Number(await scalar(conn, "SELECT count(*) FROM pragma_table_info('src')"));
    const t = performance.now();
    await conn.query("SELECT count(DISTINCT int_plain), min(int_plain), max(int_plain) FROM src");
    const probeSeconds = (performance.now() - t) / 1000;
    const result = {
      fileMb: Math.round(file.size / 1048576),
      rows,
      columns,
      loadSeconds: Math.round(loadSeconds * 10) / 10,
      probeSeconds: Math.round(probeSeconds * 10) / 10,
      jsHeapMbBefore: heapBefore,
      jsHeapMbAfter: heapMb(),
      violations: [...violations],
    };
    await conn.close();
    await engine.dispose();
    return result;
  },

  /** R2: does read_csv accept utf-16 and latin-1 for the fixture variants? */
  async encoding(variants: { file: string; encoding: string }[]) {
    const engine = await createEngine(BASE);
    const conn = await engine.db.connect();
    const byName = new Map(inputFiles().map((f) => [f.name, f]));
    const results: { file: string; encoding: string; ok: boolean; rows?: number; columns?: number; error?: string }[] = [];
    for (const v of variants) {
      const f = byName.get(v.file);
      if (!f) {
        results.push({ ...v, ok: false, error: "file not provided" });
        continue;
      }
      try {
        await engine.db.registerFileHandle(f.name, f, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
        const table = await conn.query(
          `SELECT * FROM read_csv('${f.name}', all_varchar = true, header = true, encoding = '${v.encoding}')`,
        );
        results.push({ ...v, ok: true, rows: table.numRows, columns: table.numCols });
      } catch (e) {
        results.push({ ...v, ok: false, error: String((e as Error).message).slice(0, 200) });
      }
    }
    await conn.close();
    await engine.dispose();
    return results;
  },

  /**
   * Slice 3 smoke test (FR-017): the self-hosted Excel extension loads under the strict policy and
   * reads a small workbook. Used by tests/e2e/excel-extension.spec.ts before every deploy.
   */
  async excelSmoke() {
    const [file] = inputFiles();
    const engine = await createEngine(BASE);
    const conn = await engine.db.connect();
    await conn.query(`SET custom_extension_repository = '${location.origin}${import.meta.env.BASE_URL}duckdb-ext'`);
    await conn.query("SET autoinstall_known_extensions = false");
    await conn.query("SET autoload_known_extensions = false");
    await conn.query("LOAD excel");
    const loaded = Number(await scalar(conn, "SELECT count(*) FROM duckdb_extensions() WHERE extension_name = 'excel' AND loaded"));
    await engine.db.registerFileHandle(file.name, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
    const rows = Number(await scalar(conn, `SELECT count(*) FROM read_xlsx('${file.name}', sheet = 'Data', header = true)`));
    const columns = (await conn.query(`DESCRIBE SELECT * FROM read_xlsx('${file.name}', sheet = 'Data', header = true)`)).toArray().map((r) => String(r.toJSON().column_name));
    await conn.close();
    await engine.dispose();
    return { loaded, rows, columns, violations: [...violations] };
  },

  /** R14: can a large Blob be assembled from chunks and downloaded? */
  async download(megabytes: number) {
    const chunk = new Uint8Array(1024 * 1024).fill(97);
    const parts: BlobPart[] = [];
    const started = performance.now();
    for (let i = 0; i < megabytes; i++) parts.push(chunk.slice());
    const blob = new Blob(parts, { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "spike.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    const result = { blobMb: Math.round(blob.size / 1048576), buildSeconds: Math.round(performance.now() - started) / 1000 };
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return result;
  },
};

(window as unknown as { spike: typeof spike }).spike = spike;
document.getElementById("out")!.textContent = "spike ready";
