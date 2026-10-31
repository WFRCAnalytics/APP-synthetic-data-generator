// Generalized dialog primitive — backdrop + panel + Escape-to-close + click-outside-to-close
// (the same pattern ConfirmDialog originated), now shared by ConfirmDialog, GetStartedModal,
// and HelpGuideModal instead of three independent copies of the same plumbing.

import { type ReactNode, useEffect } from "react";
import "./Modal.css";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** id of a heading element inside `children` — required for accessible naming, same
   * contract ConfirmDialog already had via aria-labelledby. */
  ariaLabelledBy: string;
  ariaDescribedBy?: string;
  /** "alertdialog" for a confirm/warn interaction (ConfirmDialog's own case); "dialog"
   * (default) for ordinary content like the Get Started or Help panels. */
  role?: "dialog" | "alertdialog";
  /** "xl" is for dense, wide content (the Calculations modal's tables) — everything else
   * fits sm/md/lg. */
  size?: "sm" | "md" | "lg" | "xl";
  children: ReactNode;
}

export function Modal({
  open,
  onClose,
  ariaLabelledBy,
  ariaDescribedBy,
  role = "dialog",
  size = "md",
  children,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className={`modal modal--${size}`}
        role={role}
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
