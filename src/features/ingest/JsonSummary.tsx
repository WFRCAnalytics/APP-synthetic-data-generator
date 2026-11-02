// What the page shows of a chosen JSON file before it is profiled (specs/007 FR-003): the counts and, for each key,
// its name and kind. No value, no text from inside a record and no nested key name is ever here.

import { InfoTip } from "../../components/InfoTip";
import { JSON_UNSUPPORTED_TEXT } from "../../lib/json/types";
import type { JsonKind } from "../../lib/json/types";
import type { JsonSummary as Summary } from "../../workers/protocol";
import { workbookSizeWarnings, workbookTooLarge } from "./sizeWarnings";

const MAX_KEYS_SHOWN = 40;

const KIND_TEXT: Record<JsonKind, string> = {
  number: "Number",
  string: "Text",
  boolean: "Yes or no (true, false)",
  null: "Always null",
  object: "Object",
  array: "List",
};

export interface JsonSummaryProps {
  fileName: string;
  fileSize: number;
  info: Summary;
  onConfirm: () => void;
  /** Hides the button once the file is being read. */
  busy: boolean;
}

export function JsonSummary({ fileName, fileSize, info, onConfirm, busy }: JsonSummaryProps) {
  const warnings = workbookSizeWarnings(info.expandedBytes, "file");
  const tooLarge = workbookTooLarge(info.expandedBytes);
  const unsupported = info.keys.filter((k) => k.unsupported).length;
  const mixed = info.keys.filter((k) => k.mixed).length;
  const renamed = info.keys.filter((k) => k.renamed).length;
  const shown = info.keys.slice(0, MAX_KEYS_SHOWN);

  return (
    <div className="card" data-testid="json-summary">
      <div className="dialog-title">
        <h3>JSON file</h3>
        <InfoTip label="More information">
          {fileName} ({(fileSize / 1048576).toFixed(1)} MB). Only the structure is read at this
          point; no value is shown.
        </InfoTip>
        {unsupported > 0 && (
          <InfoTip label="Keys that cannot be faked" tone="warning" testId="json-unsupported-note">
            {unsupported} {unsupported === 1 ? "key holds" : "keys hold"} objects or lists.{" "}
            {unsupported === 1 ? "It is" : "They are"} not read and will be left out of the fake
            file unless you keep {unsupported === 1 ? "it" : "them"} as null.
          </InfoTip>
        )}
        {mixed > 0 && (
          <InfoTip label="Keys that mix kinds" tone="warning" testId="json-mixed-note">
            {mixed} {mixed === 1 ? "key mixes" : "keys mix"} kinds of value, such as numbers and
            text, so {mixed === 1 ? "it is" : "they are"} read and written as text.
          </InfoTip>
        )}
        {renamed > 0 && (
          <InfoTip label="Keys that were renamed" tone="warning" testId="json-renamed-note">
            {renamed} {renamed === 1 ? "key has" : "keys have"} an empty name, so the reader named{" "}
            {renamed === 1 ? "it" : "them"} by position (marked below). The fake file uses the new{" "}
            {renamed === 1 ? "name" : "names"}.
          </InfoTip>
        )}
      </div>
      <p>
        <strong>{info.rowCount.toLocaleString("en-US")}</strong> records,{" "}
        <strong>{info.keys.length}</strong> keys.{" "}
        {info.layout.form === "array" ? "A list of records." : "One record per line."}
      </p>
      {warnings.map((w) => (
        <div key={w} className="banner banner-warning" role="note" data-testid="size-warning">
          {w}
        </div>
      ))}
      <details open={info.keys.length <= 12}>
        <summary>
          {info.keys.length} {info.keys.length === 1 ? "key" : "keys"} and kinds
        </summary>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Kind</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((k) => (
              <tr key={k.name}>
                <td>
                  {k.name}
                  {k.renamed && <span className="field-hint"> (named by position)</span>}
                </td>
                <td>
                  {k.unsupported
                    ? `Not supported: ${JSON_UNSUPPORTED_TEXT[k.unsupported]}`
                    : k.mixed
                      ? `${KIND_TEXT[k.kind]}, mixed kinds`
                      : KIND_TEXT[k.kind]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {info.keys.length > MAX_KEYS_SHOWN && (
          <p className="field-hint">and {info.keys.length - MAX_KEYS_SHOWN} more</p>
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
