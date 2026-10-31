// Small "nothing here yet" panel — icon + message (+ optional supporting hint) — replacing
// the bare `<p className="field-hint">…</p>` lines the Dashboard used everywhere it had
// nothing to show. Icons come from lucide-react (the app's one icon set, already used by
// SelectField/FilePickerField/AppHeader/etc.) rendered with currentColor, so this needs no
// new color tokens — it inherits --color-wfrc-gray from .empty-state same as .field-hint did.

import type { LucideIcon } from "lucide-react";
import "./EmptyState.css";

export interface EmptyStateProps {
  icon: LucideIcon;
  message: string;
  hint?: string;
}

export function EmptyState({ icon: Icon, message, hint }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <Icon className="empty-state-icon" size={28} strokeWidth={1.5} aria-hidden="true" />
      <p className="empty-state-message">{message}</p>
      {hint && <p className="empty-state-hint">{hint}</p>}
    </div>
  );
}
