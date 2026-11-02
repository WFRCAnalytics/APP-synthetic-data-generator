// A small (i) or warning icon that explains something on hover, keyboard focus or tap, so a screen can
// stay short and the longer sentence is there for whoever wants it. The tooltip text is always in the
// page (the button points at it with aria-describedby); only its look changes.

import { Info, TriangleAlert } from "lucide-react";
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
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
  const [place, setPlace] = useState<CSSProperties>({});
  const button = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const Icon = tone === "warning" ? TriangleAlert : Info;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") setPinned(false);
  };

  // The bubble is fixed to the window, not to a panel, so it never widens a scrolling panel and is never clipped by one. It
  // sits above the icon (below when there is no room), starts at the icon (ends at it for align="end") and stays inside the window.
  const placeBubble = () => {
    const b = button.current?.getBoundingClientRect();
    const t = bubble.current;
    if (!b || !t) return;
    const margin = 8;
    const width = t.offsetWidth;
    const height = t.offsetHeight;
    const wanted = align === "end" ? b.right - width + 8 : b.left - 8;
    const left = Math.min(Math.max(margin, wanted), Math.max(margin, window.innerWidth - width - margin));
    const above = b.top - height - 6 >= margin;
    setPlace({ left, top: above ? b.top - height - 6 : b.bottom + 6 });
  };

  return (
    <span className={`infotip infotip--${tone}`} onKeyDown={onKeyDown} onMouseEnter={placeBubble} onFocus={placeBubble}>
      <button ref={button} type="button" className="infotip-button" aria-label={label} aria-describedby={id} aria-expanded={pinned} onClick={() => {
          placeBubble();
          setPinned((p) => !p);
        }} onBlur={() => setPinned(false)}>
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <span ref={bubble} role="tooltip" id={id} data-testid={testId} data-open={pinned ? "true" : undefined} className="infotip-bubble" style={place}>
        {children}
      </span>
    </span>
  );
}
