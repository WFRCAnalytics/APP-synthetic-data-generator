// Generate (FR-020, FR-026, FR-029, FR-030): set a seed, generate, look at a preview of 50 fake rows
// and the check table, then export the fake file and the spec. The preview is fake data, so it is
// safe to show; the real file is never displayed.

import { InfoTip } from "../../components/InfoTip";
import { CircleCheck, CircleX, Download } from "lucide-react";
import { parseSeed, type SessionState } from "../../app/session";
import type { CheckRow } from "../../lib/generate/checks";
import { GenerateProgress } from "./GenerateProgress";
import { isExcelSettings, isJsonSettings } from "../../lib/profile/types";
import type { OutputKind } from "../../lib/spec/retarget";
import { narrowIdColumns, patternFit, shortfallText } from "../../lib/profile/idCapacity";

export interface GenerateScreenProps {
  session: SessionState;
  onSeedChange: (text: string) => void;
  onKeepNameChange: (keep: boolean) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onDownloadFake: () => void;
  onDownloadSpec: () => void;
  onDownloadReadme: () => void;
  onDownloadAll: () => void;
  outputChoices: { value: string; label: string }[];
  onOutputKindChange: (kind: OutputKind | "same") => void;
  /** Absent when the browser cannot write to a folder. */
  onSaveToFolder?: () => void;
  savedTo?: string | null;
  fakeFileName: string;
}

import { formatCheckValue } from "./checkFormat";

function CheckTable({ checks }: { checks: CheckRow[] }) {
  const failing = checks.filter((c) => !c.pass);
  // Failures first, so a problem is never buried under a hundred passes.
  const ordered = [...failing, ...checks.filter((c) => c.pass)];
  return (
    <div className="result-section">
      <h3>Check table</h3>
      <p role="status">
        {failing.length === 0 ? (
          <>
            <CircleCheck size={18} strokeWidth={1.75} aria-hidden="true" /> All {checks.length}{" "}
            checks passed.
          </>
        ) : (
          <>
            <CircleX size={18} strokeWidth={1.75} aria-hidden="true" /> {failing.length} of{" "}
            {checks.length} checks did not pass.
          </>
        )}
      </p>
      <div
        className="table-wrap table-wrap--scroll"
        tabIndex={0}
        role="region"
        aria-label="Check table rows"
      >
        <table className="data-table check-table">
          <thead>
            <tr>
              <th>Column</th>
              <th>Check</th>
              <th>Target</th>
              <th>Achieved</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((c, i) => (
              <tr key={`${c.column}-${c.metric}-${i}`} data-pass={c.pass}>
                <td>{c.column}</td>
                <td>{c.metric.replace("_", " ")}</td>
                <td title={c.target}>{formatCheckValue(c.target)}</td>
                <td title={c.achieved}>{formatCheckValue(c.achieved)}</td>
                <td className="check-result">
                  {c.pass ? (
                    <CircleCheck size={15} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <CircleX size={15} strokeWidth={2} aria-hidden="true" />
                  )}
                  {c.pass ? "Pass" : "Differs"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function GenerateScreen(props: GenerateScreenProps) {
  const { session, fakeFileName } = props;
  const { gen } = session;
  const seedOk = parseSeed(session.seedText) !== null;
  const running = gen.status === "running";
  const narrow = narrowIdColumns(session.profiles);

  return (
    <section aria-labelledby="generate-heading">
      <h2 id="generate-heading">Generate the fake table</h2>

      {session.specOnly && (
        <div className="banner banner-info" role="status" data-testid="spec-only-banner">
          Generating from a saved spec. No source file is open, so the fake table is built from the
          spec alone.
        </div>
      )}

      <div className="generate-layout">
        <div className="generate-controls">
          <div className="settings-grid settings-grid--stack">
            <div className="field">
              <span className="label-row">
                <label htmlFor="seed">Seed</label>
                <InfoTip label="More information">
                  A whole number from 0 to 4,294,967,295. The same seed always gives the same file.
                </InfoTip>
              </span>
              <input
                id="seed"
                type="text"
                inputMode="numeric"
                value={session.seedText}
                disabled={running}
                aria-invalid={!seedOk}
                onChange={(e) => props.onSeedChange(e.target.value)}
              />
            </div>

            <div className="field">
              <span className="label-row">
                <label htmlFor="keep-name">
                  <input
                    id="keep-name"
                    type="checkbox"
                    checked={session.keepOriginalName}
                    onChange={(e) => props.onKeepNameChange(e.target.checked)}
                  />{" "}
                  Keep the original file name
                </label>
                <InfoTip label="More information">
                  Off by default so a fake file is never mistaken for the real one: {fakeFileName}
                </InfoTip>
              </span>
            </div>

            {session.settings && (
              <div className="field">
                <span className="label-row">
                  <label htmlFor="output-kind">File type</label>
                  <InfoTip label="About the file type">
                    The fake table is written as the same kind of file you opened unless you pick
                    another here. Numbers, dates and yes-or-no values keep their types where the file
                    type has them. SPSS and Stata files have no value labels and cut long text (255
                    bytes for SPSS, 2,045 for Stata).
                  </InfoTip>
                </span>
                <select
                  id="output-kind"
                  value={session.outputKind}
                  disabled={running}
                  onChange={(e) => props.onOutputKindChange(e.target.value as OutputKind | "same")}
                >
                  {props.outputChoices.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {session.outputKind === "same" && session.settings && isExcelSettings(session.settings) && (
              <p className="field-hint" data-testid="one-sheet-note">
                The fake workbook holds one sheet, &ldquo;{session.settings.sheet}&rdquo;. Other
                sheets of the original workbook are not included.
              </p>
            )}
          </div>

          <div className="actions-row">
            <button
              type="button"
              className="button button-primary"
              onClick={props.onGenerate}
              disabled={running || !seedOk || narrow.length > 0}
              aria-describedby={narrow.length > 0 ? "narrow-ids" : undefined}
            >
              {gen.status === "done" ? "Generate again" : "Generate"}
            </button>
          </div>
          {narrow.length > 0 && (
            <div id="narrow-ids" className="banner banner-error" role="alert">
              {narrow.map((p) => {
                const fit = patternFit(p);
                return (
                  <p key={p.name}>
                    {p.outputName}: {fit ? shortfallText(fit) : ""} Widen its ID pattern on Review,
                    or leave the column out.
                  </p>
                );
              })}
            </div>
          )}
          {!seedOk && (
            <div className="banner banner-error" role="alert">
              Enter a whole number from 0 to 4,294,967,295 as the seed.
            </div>
          )}

          {running && <GenerateProgress progress={gen.progress} onCancel={props.onCancel} />}

          {gen.error && (
            <div className="banner banner-error" role="alert">
              {gen.error}
            </div>
          )}

          {gen.status === "done" && (
            <>
              {gen.replaced > 0 && (
                <div className="banner banner-warning" role="status">
                  {gen.replaced.toLocaleString("en-US")} characters could not be written in this
                  file&apos;s encoding and were replaced with &ldquo;?&rdquo;.
                </div>
              )}

              <div className="actions-row">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={props.onDownloadFake}
                >
                  <Download size={16} strokeWidth={1.75} aria-hidden="true" /> Download{" "}
                  {fakeFileName}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={props.onDownloadSpec}
                >
                  <Download size={16} strokeWidth={1.75} aria-hidden="true" /> Download spec (JSON)
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={props.onDownloadReadme}
                >
                  <Download size={16} strokeWidth={1.75} aria-hidden="true" /> Download README for
                  agents
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={props.onDownloadAll}
                >
                  <Download size={16} strokeWidth={1.75} aria-hidden="true" /> Download all (zip)
                </button>
                {props.onSaveToFolder && (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={props.onSaveToFolder}
                  >
                    <Download size={16} strokeWidth={1.75} aria-hidden="true" /> Save to a folder
                  </button>
                )}
              </div>
              {props.savedTo && (
                <p className="field-hint" role="status" data-testid="saved-to">
                  Saved the fake file, the spec and the README to the folder &ldquo;{props.savedTo}
                  &rdquo;.
                </p>
              )}
              <p className="field-hint">
                {(gen.totalBytes / 1048576).toFixed(2)} MB. Single-file download.
                {session.outputKind === "same" && session.settings && isJsonSettings(session.settings) && (
                  <span data-testid="json-layout">
                    {" "}
                    Written as{" "}
                    {session.settings.layout.form === "array"
                      ? `a list of records${session.settings.layout.indent === "compact" ? " on one line" : `, indented by ${session.settings.layout.indent === "tab" ? "a tab" : session.settings.layout.indent + " spaces"}`}`
                      : "one record per line"}
                    .
                  </span>
                )}
                {gen.codec && (
                  <span data-testid="parquet-codec">
                    {" "}
                    Parquet pages are{" "}
                    {gen.codec === "gzip"
                      ? "compressed with gzip, which every common reader supports"
                      : "not compressed (this browser cannot compress them)"}
                    .
                  </span>
                )}
              </p>
            </>
          )}
        </div>

        <div className="generate-results">
          {gen.status === "done" ? (
            <>
              <CheckTable checks={gen.checks} />

              <div className="result-section">
                <h3>Preview of the first {gen.preview.length} fake rows</h3>
                <div
                  className="table-wrap table-wrap--scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Preview rows"
                >
                  <table className="data-table preview-table">
                    <thead>
                      <tr>
                        {gen.header.map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {gen.preview.map((row, r) => (
                        <tr key={r}>
                          {row.map((cell, c) => (
                            <td key={c}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <p className="results-placeholder">
              The check table and a preview of the fake rows appear here once the file is generated.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
