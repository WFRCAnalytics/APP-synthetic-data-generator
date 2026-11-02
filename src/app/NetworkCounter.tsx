// The visible counter of network requests since page load (FR-033), shown on every screen so the
// privacy promise never needs developer tools to check. Same-origin requests are the app's own
// files; "outside" requests are anything else and should always read 0.

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Modal } from "../components/Modal";
import { startNetMonitoring, type NetCounter } from "./netCounter";
import { PrivacyMonitor } from "./PrivacyMonitor";
import "./NetworkCounter.css";

export interface NetworkCounterProps {
  counter: NetCounter;
  /** What the tab holds in memory (a name, a size and a row count; never content), for the monitor. */
  held?: { fileName: string; bytes: number; rows: number };
}

export function NetworkCounter({ counter, held = { fileName: "", bytes: 0, rows: 0 } }: NetworkCounterProps) {
  const counts = useSyncExternalStore(counter.subscribe, counter.getSnapshot);
  const detail = useSyncExternalStore(counter.subscribe, counter.getDetail);
  useEffect(() => startNetMonitoring(counter), [counter]);
  const [open, setOpen] = useState(false);

  const clean = counts.crossOrigin === 0 && counts.blocked === 0 && detail.sentBytes === 0;
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
      <Modal open={open} onClose={() => setOpen(false)} ariaLabelledBy="net-title" size="lg">
        <PrivacyMonitor counts={counts} detail={detail} held={held} />
        <div className="actions-row">
          <button type="button" className="button button-secondary" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </Modal>
    </span>
  );
}
