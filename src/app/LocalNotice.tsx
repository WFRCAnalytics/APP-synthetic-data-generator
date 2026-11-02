// The notice that data is handled locally and a reload clears it (FR-032): an announcement under the navbar that can be
// closed. It is not remembered (nothing is written to browser storage), so it is back on the next visit; the header's
// counter of outside requests stays on screen whether or not this is open.

import { ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import "./LocalNotice.css";

export function LocalNotice() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <aside className="local-notice" role="note" aria-label="Privacy">
      <ShieldCheck size={18} strokeWidth={1.75} aria-hidden="true" />
      <span className="local-notice-text">
        Your data is processed on this device only and is never uploaded. Reloading or closing
        this page clears everything.
      </span>
      <button type="button" className="local-notice-close" aria-label="Dismiss the privacy notice" onClick={() => setOpen(false)}>
        <X size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </aside>
  );
}
