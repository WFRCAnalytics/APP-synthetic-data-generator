// A small (i) or warning icon that explains something on hover, keyboard focus or tap, so a screen can
// stay short and the longer sentence is there for whoever wants it. The tooltip text is always in the
// page (the button points at it with aria-describedby); only its look changes.

import { Info, TriangleAlert } from "lucide-react";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import "./InfoTip.css";

export interface InfoTipProps {
  /** What the button is called for a screen reader, such as "About the cell range". */
  label: string;
  children: ReactNode;
  /** A warning icon in the warning colour, for a note that may need action. */
  tone?: "info" | "warning";
  /** Open the bubble towards the left (for a tip near the right edge). */
  align?: "start" | "end";
  testId?: string;
}

export function InfoTip({ label, children, tone = "info", align = "start", testId }: InfoTipProps) {
  const id = useId();
  const [pinned, setPinned] = useState(false);
  const Icon = tone === "warning" ? TriangleAlert : Info;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") setPinned(false);
  };

  return (
    <span className={`infotip infotip--${tone}`} onKeyDown={onKeyDown}>
      <button type="button" className="infotip-button" aria-label={label} aria-describedby={id} aria-expanded={pinned} onClick={() => setPinned((p) => !p)} onBlur={() => setPinned(false)}>
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <span role="tooltip" id={id} data-testid={testId} data-open={pinned ? "true" : undefined} className={`infotip-bubble infotip-bubble--${align}`}>
        {children}
      </span>
    </span>
  );
}
