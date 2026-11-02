// One collapsible group of a column's settings (specs/033). The title and a one-line summary stay visible when it is closed, so the
// four groups read as a short outline of the column; opening one shows its controls.

import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import "./ColumnGroup.css";

export interface ColumnGroupProps {
  id: string;
  icon: LucideIcon;
  title: string;
  /** What the group holds right now, in a few words, shown beside the title. */
  summary: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  /** Draws attention to a group that needs a look. */
  attention?: boolean;
  children: ReactNode;
}

export function ColumnGroup({ id, icon: Icon, title, summary, open, onToggle, attention = false, children }: ColumnGroupProps) {
  return (
    <details
      className={`cg ${attention ? "cg--attention" : ""}`}
      open={open}
      data-group={id}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        if (now !== open) onToggle(now);
      }}
    >
      <summary className="cg-summary">
        <ChevronRight className="cg-chevron" size={16} strokeWidth={2} aria-hidden="true" />
        <Icon className="cg-icon" size={18} strokeWidth={1.75} aria-hidden="true" />
        <span className="cg-text">
          <span className="cg-title">{title}</span>
          <span className="cg-state">{summary}</span>
        </span>
      </summary>
      <div className="cg-body">{children}</div>
    </details>
  );
}
