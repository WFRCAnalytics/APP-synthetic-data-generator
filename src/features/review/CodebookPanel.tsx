// Adds a codebook on Review: a file that says what the codes of a coded column mean. It is read in the page (never sent
// anywhere), matched to the columns and values the table already has, and kept as labels beside them.

import { useId, useState } from "react";
import { InfoTip } from "../../components/InfoTip";
import { MAX_CODEBOOK_BYTES, matchCodebook, parseCodebook } from "../../lib/codebook/codebook";
import type { ColumnProfile } from "../../lib/profile/types";

export interface CodebookPanelProps {
  profiles: readonly ColumnProfile[];
  onApply: (labels: Record<string, Record<string, string>>) => void;
}

export function CodebookPanel({ profiles, onApply }: CodebookPanelProps) {
  const id = useId();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const labelled = profiles.filter(
    (p) => p.valueLabels && Object.keys(p.valueLabels).length > 0,
  ).length;

  const read = async (file: File) => {
    if (file.size > MAX_CODEBOOK_BYTES) {
      setMessage({
        text: "This codebook is larger than 5 MB. A codebook lists codes and labels, not data.",
        ok: false,
      });
      return;
    }
    const { entries, problems } = parseCodebook(await file.text());
    if (entries.length === 0) {
      setMessage({ text: problems[0] ?? "No labels could be read from this codebook.", ok: false });
      return;
    }
    const match = matchCodebook(entries, profiles);
    if (match.applied === 0) {
      setMessage({
        text: "No label matched a column and a value of this table, so nothing was added. Check the column names and the codes.",
        ok: false,
      });
      return;
    }
    onApply(match.labels);
    const added = `Added ${match.applied.toLocaleString("en-US")} ${match.applied === 1 ? "label" : "labels"} to ${match.columns} ${match.columns === 1 ? "column" : "columns"}.`;
    const skipped =
      match.unmatched > 0
        ? ` ${match.unmatched.toLocaleString("en-US")} ${match.unmatched === 1 ? "entry matched" : "entries matched"} nothing in this table.`
        : "";
    setMessage({ text: added + skipped, ok: true });
  };

  return (
    <div className="field codebook-panel">
      <span className="label-row">
        <label htmlFor={`${id}-file`}>Add a codebook</label>
        <InfoTip label="More information">
          A file that says what the codes mean: a CSV with the columns column, value and label, or
          JSON such as {`{"mode": {"1": "Car"}}`}. The labels show on Review and in the README for
          agents. The fake file still holds the codes.
        </InfoTip>
      </span>
      <input
        id={`${id}-file`}
        type="file"
        accept=".csv,.tsv,.txt,.json,text/csv,application/json,text/plain"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void read(file);
        }}
      />
      {message && (
        <span
          className={`field-hint${message.ok ? "" : " field-error"}`}
          role={message.ok ? "status" : "alert"}
        >
          {message.text}
        </span>
      )}
      {!message && labelled > 0 && (
        <span className="field-hint" role="status">
          {labelled} {labelled === 1 ? "column has" : "columns have"} value labels.
        </span>
      )}
    </div>
  );
}
