// What the page shows of a chosen Parquet file before it is profiled (specs/005 FR-003): the counts and, for
// each column, its name and type. No value, statistic or piece of the file's own metadata text is ever here.

import { describeParquetType, UNSUPPORTED_TEXT } from "../../lib/parquet/types";
import type { ParquetSummary as Summary } from "../../workers/protocol";
import { workbookSizeWarnings, workbookTooLarge } from "./sizeWarnings";

const MAX_COLUMNS_SHOWN = 40;

export interface ParquetSummaryProps {
  fileName: string;
  fileSize: number;
  info: Summary;
  onConfirm: () => void;
  /** Hides the button once the file is being read. */
  busy: boolean;
}

export function ParquetSummary({ fileName, fileSize, info, onConfirm, busy }: ParquetSummaryProps) {
  const warnings = workbookSizeWarnings(info.expandedBytes, "file");
  const tooLarge = workbookTooLarge(info.expandedBytes);
  const unsupported = info.columns.filter((c) => c.unsupported).length;
  const shown = info.columns.slice(0, MAX_COLUMNS_SHOWN);

  return (
    <div className="card" data-testid="parquet-summary">
      <h3>Parquet file</h3>
      <p className="field-hint">
        {fileName} ({(fileSize / 1048576).toFixed(1)} MB). Only the structure is read at this point; no value and none of the file&apos;s own notes are shown.
      </p>
      <p>
        <strong>{info.rowCount.toLocaleString("en-US")}</strong> rows, <strong>{info.columns.length}</strong> columns, <strong>{info.rowGroups.toLocaleString("en-US")}</strong> row {info.rowGroups === 1 ? "group" : "groups"}.
      </p>
      {unsupported > 0 && (
        <p className="field-hint" role="note" data-testid="parquet-unsupported-note">
          {unsupported} {unsupported === 1 ? "column is" : "columns are"} nested or of a kind that cannot be faked. {unsupported === 1 ? "It is" : "They are"} not read and will be left out of the fake file unless you keep {unsupported === 1 ? "it" : "them"} as missing.
        </p>
      )}
      {warnings.map((w) => (
        <div key={w} className="banner banner-warning" role="note" data-testid="size-warning">
          {w}
        </div>
      ))}
      <details open={info.columns.length <= 12}>
        <summary>
          {info.columns.length} column {info.columns.length === 1 ? "name" : "names"} and types
        </summary>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Column</th>
              <th scope="col">Type</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td>{c.type ? `${describeParquetType(c.type)}${c.type.nullable ? "" : ", required"}` : `Not supported: ${UNSUPPORTED_TEXT[c.unsupported ?? "other"]}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {info.columns.length > MAX_COLUMNS_SHOWN && <p className="field-hint">and {info.columns.length - MAX_COLUMNS_SHOWN} more</p>}
      </details>
      <div className="actions-row">
        <button type="button" className="button button-primary" onClick={onConfirm} disabled={busy || tooLarge}>
          Profile this file
        </button>
      </div>
    </div>
  );
}
