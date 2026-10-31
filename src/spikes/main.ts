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

  /** Slice 3 R1: can the self-hosted Excel extension load under the strict CSP, and what does it read and write? */
  async excel() {
    const [file] = inputFiles();
    const engine = await createEngine(BASE);
    const conn = await engine.db.connect();
    const out: Record<string, unknown> = { violations: violations, fileMb: Math.round((file.size / 1048576) * 100) / 100 };
    const attempt = async (key: string, fn: () => Promise<unknown>) => {
      try {
        out[key] = await fn();
      } catch (e) {
        out[key] = { error: String((e as Error).message).slice(0, 300) };
      }
    };
    await attempt("repository", async () => {
      await conn.query(`SET custom_extension_repository = '${location.origin}${import.meta.env.BASE_URL}duckdb-ext'`);
      await conn.query("SET autoinstall_known_extensions = false");
      await conn.query("SET autoload_known_extensions = false");
      return "set";
    });
    await attempt("load", async () => {
      await conn.query("LOAD excel");
      return await scalar(conn, "SELECT count(*) FROM duckdb_extensions() WHERE extension_name = 'excel' AND loaded");
    });
    await engine.db.registerFileHandle(file.name, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
    const rows = async (sql: string) => (await conn.query(sql)).toArray().map((r) => r.toJSON());
    await attempt("typed", async () => rows(`DESCRIBE SELECT * FROM read_xlsx('${file.name}', sheet = 'Survey Data', range = 'A3:I203', header = true)`));
    await attempt("typedHead", async () => rows(`SELECT * FROM read_xlsx('${file.name}', sheet = 'Survey Data', range = 'A3:I203', header = true) LIMIT 3`));
    await attempt("allVarchar", async () => rows(`SELECT * FROM read_xlsx('${file.name}', sheet = 'Survey Data', range = 'A3:I203', header = true, all_varchar = true) LIMIT 3`));
    await attempt("count", async () => rows(`SELECT count(*) AS n FROM read_xlsx('${file.name}', sheet = 'Survey Data', range = 'A3:I203', header = true)`));
    await attempt("noRange", async () => rows(`DESCRIBE SELECT * FROM read_xlsx('${file.name}', sheet = 'Survey Data', header = false) LIMIT 1`));
    await attempt("blanksAndEmpty", async () => rows(`SELECT count(*) FILTER (WHERE score IS NULL) AS null_score, count(*) FILTER (WHERE flag = '') AS empty_flag, count(*) FILTER (WHERE flag IS NULL) AS null_flag FROM read_xlsx('${file.name}', sheet = 'Survey Data', range = 'A3:I203', header = true)`));
    await attempt("formula", async () => rows(`SELECT amount, total FROM read_xlsx('${file.name}', sheet = 'Survey Data', range = 'A3:I203', header = true) LIMIT 2`));
    await attempt("write", async () => {
      await conn.query("CREATE TABLE t AS SELECT 'a' AS name, 1.5 AS amount, DATE '2024-02-03' AS d, '00123' AS code");
      await conn.query("COPY t TO 'fake.xlsx' (FORMAT xlsx, HEADER true, SHEET 'Mine')");
      const bytes = await engine.db.copyFileToBuffer("fake.xlsx");
      return { bytes: bytes.length, magic: Array.from(bytes.slice(0, 4)) };
    });
    await conn.close();
    await engine.dispose();
    return JSON.parse(JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
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
