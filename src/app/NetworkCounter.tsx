// The visible counter of network requests since page load (FR-033), shown on every screen so the
// privacy promise never needs developer tools to check. Same-origin requests are the app's own
// files; "outside" requests are anything else and should always read 0.

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Modal } from "../components/Modal";
import { startNetMonitoring, type NetCounter } from "./netCounter";
import "./NetworkCounter.css";

export interface NetworkCounterProps {
  counter: NetCounter;
}

export function NetworkCounter({ counter }: NetworkCounterProps) {
  const counts = useSyncExternalStore(counter.subscribe, counter.getSnapshot);
  useEffect(() => startNetMonitoring(counter), [counter]);
  const [open, setOpen] = useState(false);

  const clean = counts.crossOrigin === 0 && counts.blocked === 0;
  const Icon = clean ? ShieldCheck : ShieldAlert;
  const label = `Network requests since this page loaded: ${counts.crossOrigin} outside this site, ${counts.sameOrigin} from this site, ${counts.blocked} blocked.`;
  const explanation = clean
    ? `Nothing you open is sent anywhere. Since this page loaded it made ${counts.sameOrigin} requests, all to this site itself (the app's own files and the data reader), and 0 to any other address.`
    : `${counts.crossOrigin + counts.blocked} request(s) tried to reach another address. Your data was not sent, but close this tab and tell the maintainers.`;

  return (
    <span
      className={`net-counter ${clean ? "net-counter--clean" : "net-counter--alert"}`}
      role="group"
      aria-label={label}
      title={`${explanation} (${label})`}
      data-testid="net-counter"
    >
      <button type="button" className="net-counter-button" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className="net-counter-text">{clean ? "Stays on this device" : "Outside requests seen"}</span>
      </button>
      <span className="visually-hidden">
        <strong data-testid="net-outside">{counts.crossOrigin}</strong> outside, <span data-testid="net-local">{counts.sameOrigin}</span> local
        {counts.blocked > 0 ? (
          <>
            , <span data-testid="net-blocked">{counts.blocked}</span> blocked
          </>
        ) : null}
      </span>
      <Modal open={open} onClose={() => setOpen(false)} ariaLabelledBy="net-title" size="sm">
        <div className="net-dialog">
          <h2 id="net-title">{clean ? "Your data stays on this device" : "Something tried to reach another address"}</h2>
          <p>{explanation}</p>
          <dl className="net-dialog-list">
            <dt>To other websites</dt>
            <dd>
              <strong>{counts.crossOrigin}</strong> <span className="field-hint">This should always be 0.</span>
            </dd>
            <dt>To this site</dt>
            <dd>
              <strong>{counts.sameOrigin}</strong> <span className="field-hint">The app&apos;s own pages and scripts, and the files that read Excel, Parquet, JSON, SPSS and Stata.</span>
            </dd>
            <dt>Blocked</dt>
            <dd>
              <strong>{counts.blocked}</strong> <span className="field-hint">Attempts the browser refused to send.</span>
            </dd>
          </dl>
          <p className="field-hint">The counts cover everything this page and its workers have requested since it loaded. Reloading starts them again from zero.</p>
          <div className="actions-row">
            <button type="button" className="button button-secondary" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      </Modal>
    </span>
  );
}
