// Generalized dialog primitive — backdrop + panel + Escape-to-close + click-outside-to-close
// (the same pattern ConfirmDialog originated), now shared by ConfirmDialog, GetStartedModal,
// and HelpGuideModal instead of three independent copies of the same plumbing.

import { type ReactNode, useEffect, useRef } from "react";
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
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Keyboard users: focus moves into the dialog, Tab stays inside it, and focus returns to
    // whatever opened it when it closes.
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(panel.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    (focusables()[0] ?? panel.current)?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={panel}
        tabIndex={-1}
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
