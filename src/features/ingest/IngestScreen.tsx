// Ingest (FR-001 to FR-003): choose a CSV, confirm the detected settings, and see the row count,
// column count and column names. Never any row values.

import { FileUp, PencilRuler, Upload } from "lucide-react";
import { useRef } from "react";
import { InfoTip } from "../../components/InfoTip";
import { EmptyState } from "../../components/EmptyState";
import {
  isExcelSettings,
  isJsonSettings,
  isParquetSettings,
  type FileSettings,
} from "../../lib/profile/types";
import type { SessionState, WorkbookChoice } from "../../app/session";
import { JsonSummary } from "./JsonSummary";
import { ParquetSummary } from "./ParquetSummary";
import { StatSummary } from "./StatSummary";
import { WorkbookDialog } from "./WorkbookDialog";
import { ProfileProgress } from "./ProfileProgress";
import { SizeWarning } from "./SizeWarning";
import { SpecErrors } from "../spec/SpecErrors";

export interface IngestScreenProps {
  session: SessionState;
  onChooseFile: (file: File) => void;
  onChooseSpec: (file: File) => void;
  onInspectSheet: (sheet: string) => void;
  onConfirmWorkbook: (choice: WorkbookChoice) => void;
  onConfirmParquet: () => void;
  onConfirmStat: () => void;
  onConfirmJson: () => void;
  onEditSettings: (patch: Partial<FileSettings>) => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** Opens the Design screen: a table made from nothing. */
  onStartDesign?: () => void;
}

const DELIMITERS: [string, string][] = [
  [",", "Comma (,)"],
  [";", "Semicolon (;)"],
  ["\t", "Tab"],
  ["|", "Pipe (|)"],
];

const ENCODINGS: [FileSettings["encoding"], string][] = [
  ["utf-8", "UTF-8"],
  ["utf-16le", "UTF-16 (little endian)"],
  ["utf-16be", "UTF-16 (big endian)"],
  ["windows-1252", "Windows-1252 / Latin-1"],
];

const MAX_NAMES_SHOWN = 40;

export function IngestScreen({
  session,
  onChooseFile,
  onChooseSpec,
  onInspectSheet,
  onConfirmWorkbook,
  onConfirmParquet,
  onConfirmStat,
  onConfirmJson,
  onEditSettings,
  onConfirm,
  onCancel,
  onStartDesign,
}: IngestScreenProps) {
  const input = useRef<HTMLInputElement>(null);
  const { phase } = session;
  // The CSV panel is for CSV files; a workbook has its own dialog, and a Parquet file its own summary.
  const settings =
    session.settings &&
    !isExcelSettings(session.settings) &&
    !isParquetSettings(session.settings) &&
    !isJsonSettings(session.settings)
      ? session.settings
      : null;
  const busy = phase === "opening" || phase === "loading" || phase === "profiling";
  const names = session.columnNames;
  // Once a file is open its settings are the work; the two ways in fold into a one-line bar.
  const compact = phase !== "idle" && !session.specOnly && session.fileName !== "";

  return (
    <section aria-labelledby="ingest-heading" className={compact ? "ingest-compact" : undefined}>
      <h2 id="ingest-heading">Make test data that behaves like yours, without using yours</h2>
      <p className="lead">Start from a file you have, or design a table from nothing.</p>

      {compact && (
        <div className="source-bar">
          <FileUp size={18} strokeWidth={1.75} aria-hidden="true" />
          <span className="source-bar-name">{session.fileName}</span>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => input.current?.click()}
            disabled={busy}
          >
            Choose a different file
          </button>
        </div>
      )}

      <div className="doors">
        <div className="door door--drop">
          <span className="door-icon" aria-hidden="true">
            <Upload size={24} strokeWidth={1.75} />
          </span>
          <div>
            <h3>Start from a file</h3>
            <p>Learns your columns, then makes new rows that look alike.</p>
          </div>
          <div className="door-formats" aria-hidden="true">
            <span>CSV</span>
            <span>Excel</span>
            <span>Parquet</span>
            <span>JSON</span>
            <span>SPSS</span>
            <span>Stata</span>
            <span>SAS</span>
          </div>
          <div className="field field--drop">
            <span className="label-row">
              <label htmlFor="file-input">Data file</label>
              <InfoTip label="About the file">
                Up to about 500 MB. The file stays on this device. An Excel workbook (.xlsx) asks
                which sheet to read. SPSS (.sav), Stata (.dta) and SAS (.sas7bdat, .xpt) files are
                read as tables; SPSS and Stata are written back as the same kind of file, SAS as a CSV. One file at a time; a folder of Parquet files is not supported.
              </InfoTip>
            </span>
            <input
              id="file-input"
              ref={input}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.parquet,.json,.ndjson,.jsonl,.sav,.zsav,.dta,.sas7bdat,.xpt,application/json,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.apache.parquet"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onChooseFile(file);
              }}
            />
          </div>
        </div>

        {onStartDesign && (
          <div className="door design-entry">
            <span className="door-icon door-icon--accent" aria-hidden="true">
              <PencilRuler size={24} strokeWidth={1.75} />
            </span>
            <div>
              <h3>Start from scratch</h3>
              <p>Add columns one at a time and say what each should hold.</p>
            </div>
            <div className="door-formats" aria-hidden="true">
              <span>Whole number</span>
              <span>Decimal</span>
              <span>Category</span>
              <span>Yes or no</span>
              <span>Date</span>
              <span>ID</span>
              <span>Name or address</span>
              <span>Free text</span>
            </div>
            <div className="door-action">
              <button
                type="button"
                className="button button-secondary"
                onClick={onStartDesign}
                disabled={busy}
              >
                Design a table
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="field spec-load">
        <label htmlFor="spec-input">Load existing spec</label>
        <InfoTip label="About loading a spec">
          A spec saved earlier skips profiling. It replaces any file that is open.
        </InfoTip>
        <input
          id="spec-input"
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // choosing the same spec again must still fire
            if (file) onChooseSpec(file);
          }}
        />
      </div>

      {session.specProblems && <SpecErrors problems={session.specProblems} />}

      {session.specOnly && (
        <div className="banner banner-info" role="status">
          A saved spec is loaded ({session.fileName}: {session.rowCount.toLocaleString("en-US")}{" "}
          rows, {session.columnNames.length} columns). Go to Review to check it, or choose a file to
          start over.
        </div>
      )}

      {session.error && (
        <div className="banner banner-error" role="alert">
          {session.error}
        </div>
      )}

      {phase === "idle" && !session.specProblems && (
        <EmptyState
          icon={FileUp}
          message="Choose a CSV, Excel, Parquet, JSON, SPSS, Stata or SAS file to begin."
          hint="Nothing is uploaded; everything happens in this tab."
        />
      )}

      {phase === "opening" && (
        <ProfileProgress progress={null} label="Reading the start of the file" />
      )}

      {settings && !session.specOnly && phase !== "idle" && phase !== "opening" && (
        <div className="card">
          <h3>Detected settings</h3>
          <p className="field-hint">
            {session.fileName} ({(session.fileSize / 1048576).toFixed(1)} MB)
            {session.confidence === "low" ? ". The encoding is a best guess; check it below." : ""}
          </p>

          <div className="settings-grid">
            <div className="field">
              <label htmlFor="delimiter">Delimiter</label>
              <select
                id="delimiter"
                value={settings.delimiter}
                disabled={busy || phase === "profiled"}
                onChange={(e) => onEditSettings({ delimiter: e.target.value })}
              >
                {DELIMITERS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="encoding">Encoding</label>
              <select
                id="encoding"
                value={settings.encoding}
                disabled={busy || phase === "profiled"}
                onChange={(e) =>
                  onEditSettings({ encoding: e.target.value as FileSettings["encoding"] })
                }
              >
                {ENCODINGS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="quote">Quote character</label>
              <select
                id="quote"
                value={settings.quote ?? ""}
                disabled={busy || phase === "profiled"}
                onChange={(e) =>
                  onEditSettings({ quote: e.target.value === "" ? null : e.target.value })
                }
              >
                <option value={'"'}>Double quote (&quot;)</option>
                <option value="">None</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="header">
                <input
                  id="header"
                  type="checkbox"
                  checked={settings.header}
                  disabled={busy || phase === "profiled"}
                  onChange={(e) => onEditSettings({ header: e.target.checked })}
                />{" "}
                First row is a header
              </label>
            </div>
          </div>

          <p className="field-hint">
            Line endings: {settings.lineEnding.toUpperCase()} &middot; quoting:{" "}
            {settings.quoteStyle.replace("_", " ")} &middot; ends with a newline:{" "}
            {settings.trailingNewline ? "yes" : "no"}
          </p>

          <SizeWarning fileSize={session.fileSize} encoding={settings.encoding} />

          {session.rowCount > 0 && (
            <p>
              <strong>{session.rowCount.toLocaleString("en-US")}</strong> rows and{" "}
              <strong>{names.length}</strong> columns.
            </p>
          )}

          <details open={names.length <= 12}>
            <summary>
              {names.length} column {names.length === 1 ? "name" : "names"}
            </summary>
            <ul className="name-list">
              {names.slice(0, MAX_NAMES_SHOWN).map((n) => (
                <li key={n}>{n}</li>
              ))}
              {names.length > MAX_NAMES_SHOWN && <li>and {names.length - MAX_NAMES_SHOWN} more</li>}
            </ul>
          </details>

          {phase === "opened" && (
            <div className="actions-row">
              <button type="button" className="button button-primary" onClick={onConfirm}>
                Looks right, profile this file
              </button>
            </div>
          )}
        </div>
      )}

      {phase === "parquet" && session.parquet && (
        <ParquetSummary
          fileName={session.fileName}
          fileSize={session.fileSize}
          info={session.parquet}
          onConfirm={onConfirmParquet}
          busy={busy}
        />
      )}

      {phase === "stat" && session.stat && (
        <StatSummary
          fileSize={session.fileSize}
          info={session.stat}
          onConfirm={onConfirmStat}
          busy={busy}
        />
      )}

      {phase === "json" && session.json && (
        <JsonSummary
          fileName={session.fileName}
          fileSize={session.fileSize}
          info={session.json}
          onConfirm={onConfirmJson}
          busy={busy}
        />
      )}

      {phase === "workbook" && session.workbook && (
        <WorkbookDialog
          workbook={session.workbook}
          fileName={session.fileName}
          onInspect={onInspectSheet}
          onConfirm={onConfirmWorkbook}
        />
      )}

      {session.settings &&
        isExcelSettings(session.settings) &&
        !session.specOnly &&
        phase !== "workbook" && (
          <div className="card" data-testid="workbook-summary">
            <h3>Workbook</h3>
            <p className="field-hint">
              {session.fileName}: sheet &ldquo;{session.settings.sheet}&rdquo;,{" "}
              {session.settings.skipRows === 0
                ? "header on the first row"
                : `${session.settings.skipRows} rows skipped above the header`}
              {session.settings.range ? `, range ${session.settings.range}` : ""}. Only this sheet
              is read.
            </p>
            {session.rowCount > 0 && (
              <p>
                <strong>{session.rowCount.toLocaleString("en-US")}</strong> rows and{" "}
                <strong>{names.length}</strong> columns.
              </p>
            )}
            <details open={names.length <= 12}>
              <summary>
                {names.length} column {names.length === 1 ? "name" : "names"}
              </summary>
              <ul className="name-list">
                {names.slice(0, MAX_NAMES_SHOWN).map((n) => (
                  <li key={n}>{n}</li>
                ))}
                {names.length > MAX_NAMES_SHOWN && (
                  <li>and {names.length - MAX_NAMES_SHOWN} more</li>
                )}
              </ul>
            </details>
          </div>
        )}

      {phase === "loading" && (
        <ProfileProgress progress={session.progress} label="Reading the file" onCancel={onCancel} />
      )}
      {phase === "profiling" && (
        <ProfileProgress
          progress={session.progress}
          label="Profiling columns"
          onCancel={onCancel}
        />
      )}
    </section>
  );
}
