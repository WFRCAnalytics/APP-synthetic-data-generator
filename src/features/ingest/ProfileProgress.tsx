// Progress for reading and profiling a file (FR-033): a bar that fills as columns are profiled, an
// honest "working" bar while the total is not known yet, and a Cancel that stops the worker.

import type { Progress } from "../../app/session";

export interface ProfileProgressProps {
  progress: Progress | null;
  label: string;
  /** Shown as a Cancel button when given. */
  onCancel?: () => void;
}

const percentOf = (progress: Progress | null): number | null =>
  progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;

export function ProfileProgress({ progress, label, onCancel }: ProfileProgressProps) {
  const percent = percentOf(progress);
  return (
    <div className="progress-block" role="status" aria-live="polite">
      <label>
        {label}
        {percent === null ? "" : ` (${percent}%)`}
        <progress max={percent === null ? undefined : 100} value={percent === null ? undefined : percent} />
      </label>
      {onCancel && (
        <button type="button" className="button button-secondary" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}
