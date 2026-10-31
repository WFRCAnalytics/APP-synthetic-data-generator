// Shared confirmation dialog — the one UI pattern behind all three "delete an entity that
// has scores attached" requirements (FR-007 firms, FR-039 criteria, FR-041 reviewers).
// Centralizing it here means all three editors ask the same way and can't drift.
//
// Built on Modal.tsx (the generic backdrop/dialog primitive) rather than its own copy of
// that plumbing — external props/behavior are unchanged from before this refactor.

import type { ReactNode } from "react";
import { Modal } from "./Modal";
import "./ConfirmDialog.css";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Remove",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      role="alertdialog"
      ariaLabelledBy="confirm-dialog-title"
      ariaDescribedBy="confirm-dialog-message"
      size="sm"
    >
      <h2 id="confirm-dialog-title">{title}</h2>
      <p id="confirm-dialog-message">{message}</p>
      <div className="confirm-dialog-actions">
        <button type="button" className="button button-secondary" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className="button button-danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
