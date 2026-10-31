// Persistent notice that data is handled locally and a reload clears it (FR-032). Shown on every
// screen so the privacy promise is never out of sight.

import { ShieldCheck } from "lucide-react";
import "./LocalNotice.css";

export function LocalNotice() {
  return (
    <aside className="local-notice" role="note" aria-label="Privacy">
      <ShieldCheck size={18} strokeWidth={1.75} aria-hidden="true" />
      <span>
        Your data is processed on this device only and is never uploaded. Reloading or closing
        this page clears everything.
      </span>
    </aside>
  );
}
