// What the page shows of a chosen SPSS or Stata file before it is profiled (specs/017 FR-003): the counts and, for
// each variable, its name and kind. No value and no label is ever here.

import { InfoTip } from "../../components/InfoTip";
import { STAT_FORMAT_NAMES } from "../../lib/stat/detect";
import type { StatSummary as Summary } from "../../workers/protocol";
import { workbookSizeWarnings, workbookTooLarge } from "./sizeWarnings";

const MAX_SHOWN = 40;

const KIND_TEXT: Record<Summary["columns"][number]["kind"], string> = {
  number: "Number",
  text: "Text",
  date: "Date",
  datetime: "Date and time",
};

export interface StatSummaryProps {
  fileSize: number;
  info: Summary;
  onConfirm: () => void;
  /** Hides the button once the file is being read. */
  busy: boolean;
}

export function StatSummary({ fileSize, info, onConfirm, busy }: StatSummaryProps) {
  const warnings = workbookSizeWarnings(info.expandedBytes, "file");
  const tooLarge = workbookTooLarge(info.expandedBytes);
  const shown = info.columns.slice(0, MAX_SHOWN);
  const name = STAT_FORMAT_NAMES[info.format];

  return (
    <div className="card" data-testid="stat-summary">
      <div className="dialog-title">
        <h3>{name} file</h3>
        <InfoTip label="More information">
          {info.sourceName} ({(fileSize / 1048576).toFixed(1)} MB). Only the structure is read at
          this point; no value is shown. The data is read as a plain table, and the fake file is the same kind of file by default (other file types are on the Generate screen). Value labels are kept beside the columns on Review (they are not written into the fake file); variable labels are not read.
        </InfoTip>
      </div>
      <p>
        <strong>{info.rowCount.toLocaleString("en-US")}</strong> rows,{" "}
        <strong>{info.columns.length}</strong> variables.
        {info.labels.length > 0 && (
          <span data-testid="stat-labels">
            {" "}
            The file says what {info.labels.length.toLocaleString("en-US")}{" "}
            {info.labels.length === 1 ? "code means" : "codes mean"}; these labels will be kept
            beside the columns on Review.
          </span>
        )}
      </p>
      {warnings.map((w) => (
        <div key={w} className="banner banner-warning" role="note" data-testid="size-warning">
          {w}
        </div>
      ))}
      <details open={info.columns.length <= 12}>
        <summary>
          {info.columns.length} {info.columns.length === 1 ? "variable" : "variables"} and kinds
        </summary>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Variable</th>
              <th scope="col">Kind</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td>{KIND_TEXT[c.kind]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {info.columns.length > MAX_SHOWN && (
          <p className="field-hint">and {info.columns.length - MAX_SHOWN} more</p>
        )}
      </details>
      <div className="actions-row">
        <button
          type="button"
          className="button button-primary"
          onClick={onConfirm}
          disabled={busy || tooLarge}
        >
          Profile this file
        </button>
      </div>
    </div>
  );
}
