// Several tables from their saved specs in one go (specs/028): choose the specs, see which tables are in the set and whether their
// links fit together, make them all, and download every file in one zip. The specs hold no real data, so nothing here reads any.

import { Download } from "lucide-react";
import { useRef, useState } from "react";
import { downloadBlob } from "../../app/download";
import { zipOf } from "../../app/saveAll";
import {
  batchFileName,
  batchFiles,
  type BatchOutput,
  batchWarnings,
  loadBatch,
  MAX_BATCH_TABLES,
  runTable,
  type BatchRejected,
  type BatchResult,
  type BatchTable,
} from "../../app/batch";
import { InfoTip } from "../../components/InfoTip";
import { DESIGN_OUTPUTS } from "../../lib/design/types";
import { CONVERT_KINDS } from "../../lib/stat/detect";

type Status = { state: "waiting" } | { state: "running"; share: number } | { state: "done"; result: BatchResult } | { state: "error"; message: string };

export function BatchPanel() {
  const [tables, setTables] = useState<BatchTable[]>([]);
  const [rejected, setRejected] = useState<BatchRejected[]>([]);
  const [status, setStatus] = useState<Record<number, Status>>({});
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<BatchOutput>("same");
  const cancel = useRef<(() => void) | null>(null);
  const stopped = useRef(false);

  const choose = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const chosen = [...files].slice(0, MAX_BATCH_TABLES);
    const { tables: loaded, rejected: bad } = await loadBatch(chosen);
    setTables(loaded);
    setRejected(files.length > MAX_BATCH_TABLES ? [...bad, { specName: `${files.length - MAX_BATCH_TABLES} more files`, reason: `A set holds at most ${MAX_BATCH_TABLES} tables.` }] : bad);
    setStatus(Object.fromEntries(loaded.map((t) => [t.id, { state: "waiting" } as Status])));
  };

  const makeAll = async () => {
    stopped.current = false;
    setBusy(true);
    setStatus(Object.fromEntries(tables.map((t) => [t.id, { state: "waiting" } as Status])));
    for (const t of tables) {
      if (stopped.current) break;
      setStatus((s) => ({ ...s, [t.id]: { state: "running", share: 0 } }));
      try {
        const result = await runTable(
          t.spec,
          (share) => setStatus((s) => ({ ...s, [t.id]: { state: "running", share } })),
          (c) => {
            cancel.current = c;
          },
          output,
        );
        setStatus((s) => ({ ...s, [t.id]: { state: "done", result } }));
      } catch (err) {
        setStatus((s) => ({ ...s, [t.id]: { state: "error", message: stopped.current ? "Stopped." : (err as Error).message } }));
      }
    }
    cancel.current = null;
    setBusy(false);
  };

  const results = new Map<number, BatchResult>();
  for (const t of tables) {
    const st = status[t.id];
    if (st?.state === "done") results.set(t.id, st.result);
  }
  const warnings = batchWarnings(tables);

  return (
    <div className="card batch-panel" data-testid="batch-panel">
      <div className="dialog-title">
        <h3>Make several tables at once</h3>
        <InfoTip label="About making several tables">
          Choose the saved specs of several tables, such as households and persons whose ID columns are linked. Each table is made from its own
          spec and seed, and all the files come out together in one zip. Nothing is read from any real file.
        </InfoTip>
      </div>
      <div className="inline-row batch-controls">
      <input
        id="batch-input"
        type="file"
        multiple
        accept=".json,application/json"
        aria-label="Specs of the tables"
        disabled={busy}
        onChange={(e) => {
          const files = e.target.files;
          void choose(files).then(() => {
            e.target.value = "";
          });
        }}
      />
      <div className="field inline-field">
        <label htmlFor="batch-output">File type</label>
        <select
          id="batch-output"
          value={output}
          disabled={busy}
          onChange={(e) => {
            setOutput(e.target.value as BatchOutput);
            setStatus(Object.fromEntries(tables.map((t) => [t.id, { state: "waiting" } as Status])));
          }}
        >
          <option value="same">As each spec says</option>
          {[...DESIGN_OUTPUTS, ...CONVERT_KINDS].map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} (.{o.extension})
            </option>
          ))}
        </select>
      </div>
      </div>
      {rejected.map((r) => (
        <p key={r.specName} className="field-hint" role="alert">
          {r.specName}: {r.reason}
        </p>
      ))}
      {tables.length > 0 && (
        <>
          <table className="data-table" data-testid="batch-table">
            <thead>
              <tr>
                <th scope="col">Table</th>
                <th scope="col">Rows</th>
                <th scope="col">Seed</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => {
                const st = status[t.id];
                return (
                  <tr key={t.id}>
                    <td>{batchFileName(t.spec, output)}</td>
                    <td>{t.spec.n_rows.toLocaleString("en-US")}</td>
                    <td>{t.spec.seed}</td>
                    <td data-testid={`batch-status-${t.spec.source.file_name}`}>
                      {!st || st.state === "waiting"
                        ? "Waiting"
                        : st.state === "running"
                          ? `Making ${Math.round(st.share * 100)}%`
                          : st.state === "error"
                            ? st.message
                            : `${
                                st.result.failed === 0
                                  ? `Done, ${st.result.passed} checks passed`
                                  : `Done, ${st.result.failed} of ${st.result.checks.length} checks did not pass`
                              }${st.result.truncated ? `; ${st.result.truncated.toLocaleString("en-US")} long text values were cut to fit the file type` : ""}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {warnings.map((w) => (
            <div key={w} className="banner banner-warning" role="note" data-testid="batch-warning">
              {w}
            </div>
          ))}
          <div className="actions-row">
            <button type="button" className="button button-primary" disabled={busy} onClick={() => void makeAll()}>
              Make all tables
            </button>
            {busy && (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  stopped.current = true;
                  cancel.current?.();
                }}
              >
                Stop
              </button>
            )}
            <button
              type="button"
              className="button button-secondary"
              disabled={busy || results.size === 0}
              onClick={() => void zipOf(batchFiles(tables, results, output)).then((zip) => downloadBlob(zip, "tables.zip"))}
            >
              <Download size={16} strokeWidth={1.75} aria-hidden="true" /> Download all (zip)
            </button>
          </div>
        </>
      )}
    </div>
  );
}
