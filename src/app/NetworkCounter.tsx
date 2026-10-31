// The visible counter of network requests since page load (FR-033), shown on every screen so the
// privacy promise never needs developer tools to check. Same-origin requests are the app's own
// files; "outside" requests are anything else and should always read 0.

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { startNetMonitoring, type NetCounter } from "./netCounter";
import "./NetworkCounter.css";

export interface NetworkCounterProps {
  counter: NetCounter;
}

export function NetworkCounter({ counter }: NetworkCounterProps) {
  const counts = useSyncExternalStore(counter.subscribe, counter.getSnapshot);
  useEffect(() => startNetMonitoring(counter), [counter]);

  const clean = counts.crossOrigin === 0 && counts.blocked === 0;
  const Icon = clean ? ShieldCheck : ShieldAlert;
  const label = `Network requests since this page loaded: ${counts.crossOrigin} outside this site, ${counts.sameOrigin} from this site, ${counts.blocked} blocked.`;

  return (
    <span
      className={`net-counter ${clean ? "net-counter--clean" : "net-counter--alert"}`}
      role="group"
      aria-label={label}
      title={`${label} Outside requests should always be 0: your data never leaves this device.`}
      data-testid="net-counter"
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
      <span className="net-counter-text" aria-hidden="true">
        <strong data-testid="net-outside">{counts.crossOrigin}</strong> outside &middot; <span data-testid="net-local">{counts.sameOrigin}</span> local
        {counts.blocked > 0 ? (
          <>
            {" "}
            &middot; <span data-testid="net-blocked">{counts.blocked}</span> blocked
          </>
        ) : null}
      </span>
    </span>
  );
}
