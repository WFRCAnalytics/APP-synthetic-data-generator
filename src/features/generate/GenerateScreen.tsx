// Generate (FR-020, FR-026, FR-029, FR-030): set a seed, generate, look at a preview of 50 fake rows
// and the check table, then export the fake file and the spec. The preview is fake data, so it is
// safe to show; the real file is never displayed.

import { CircleCheck, CircleX, Download } from "lucide-react";
import { parseSeed, type SessionState } from "../../app/session";
import type { CheckRow } from "../../lib/generate/checks";
import { GenerateProgress } from "./GenerateProgress";
import { isExcelSettings } from "../../lib/profile/types";
import { narrowIdColumns, patternFit, shortfallText } from "../../lib/profile/idCapacity";

export interface GenerateScreenProps {
  session: SessionState;
  onSeedChange: (text: string) => void;
  onKeepNameChange: (keep: boolean) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onDownloadFake: () => void;
  onDownloadSpec: () => void;
  fakeFileName: string;
}

function CheckTable({ checks }: { checks: CheckRow[] }) {
  const failing = checks.filter((c) => !c.pass);
  // Failures first, so a problem is never buried under a hundred passes.
  const ordered = [...failing, ...checks.filter((c) => c.pass)];
  return (
    <div className="card">
      <h3>Check table</h3>
      <p role="status">
        {failing.length === 0 ? (
          <>
            <CircleCheck size={18} strokeWidth={1.75} aria-hidden="true" /> All {checks.length} checks passed.
          </>
        ) : (
          <>
            <CircleX size={18} strokeWidth={1.75} aria-hidden="true" /> {failing.length} of {checks.length} checks did not pass.
          </>
        )}
      </p>
      <div className="table-wrap table-wrap--scroll" tabIndex={0} role="region" aria-label="Check table rows">
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
                <td>{c.target}</td>
                <td>{c.achieved}</td>
                <td>{c.pass ? "Pass" : "Differs"}</td>
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
          Generating from a saved spec. No source file is open, so the fake table is built from the spec alone.
        </div>
      )}

      <div className="settings-grid">
        <div className="field">
          <label htmlFor="seed">Seed</label>
          <input id="seed" type="text" inputMode="numeric" value={session.seedText} disabled={running} aria-invalid={!seedOk} aria-describedby="seed-hint" onChange={(e) => props.onSeedChange(e.target.value)} />
          <span id="seed-hint" className="field-hint">
            A whole number from 0 to 4,294,967,295. The same seed always gives the same file.
          </span>
        </div>

        <div className="field">
          <label htmlFor="keep-name">
            <input id="keep-name" type="checkbox" checked={session.keepOriginalName} onChange={(e) => props.onKeepNameChange(e.target.checked)} /> Keep the original file name
          </label>
          <span className="field-hint">Off by default so a fake file is never mistaken for the real one: {fakeFileName}</span>
        </div>

        {session.settings && isExcelSettings(session.settings) && (
          <p className="field-hint" data-testid="one-sheet-note">
            The fake workbook holds one sheet, &ldquo;{session.settings.sheet}&rdquo;. Other sheets of the original workbook are not included.
          </p>
        )}
      </div>

      <div className="actions-row">
        <button type="button" className="button button-primary" onClick={props.onGenerate} disabled={running || !seedOk || narrow.length > 0} aria-describedby={narrow.length > 0 ? "narrow-ids" : undefined}>
          {gen.status === "done" ? "Generate again" : "Generate"}
        </button>
      </div>
      {narrow.length > 0 && (
        <div id="narrow-ids" className="banner banner-error" role="alert">
          {narrow.map((p) => {
            const fit = patternFit(p);
            return (
              <p key={p.name}>
                {p.outputName}: {fit ? shortfallText(fit) : ""} Widen its ID pattern on Review, or leave the column out.
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
              {gen.replaced.toLocaleString("en-US")} characters could not be written in this file&apos;s encoding and were replaced with &ldquo;?&rdquo;.
            </div>
          )}

          <div className="actions-row">
            <button type="button" className="button button-primary" onClick={props.onDownloadFake}>
              <Download size={16} strokeWidth={1.75} aria-hidden="true" /> Download {fakeFileName}
            </button>
            <button type="button" className="button button-secondary" onClick={props.onDownloadSpec}>
              <Download size={16} strokeWidth={1.75} aria-hidden="true" /> Download spec (JSON)
            </button>
          </div>
          <p className="field-hint">{(gen.totalBytes / 1048576).toFixed(2)} MB. Single-file download.</p>

          <CheckTable checks={gen.checks} />

          <div className="card">
            <h3>Preview of the first {gen.preview.length} fake rows</h3>
            <div className="table-wrap table-wrap--scroll" tabIndex={0} role="region" aria-label="Preview rows">
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
      )}
    </section>
  );
}
