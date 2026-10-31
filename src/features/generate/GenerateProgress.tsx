// Progress for generating and encoding the fake file (FR-033): rows done out of rows total, and a
// Cancel that stops the generating worker between chunks.

import type { Progress } from "../../app/session";

export interface GenerateProgressProps {
  progress: Progress | null;
  onCancel: () => void;
}

export function GenerateProgress({ progress, onCancel }: GenerateProgressProps) {
  const total = progress?.total ?? 0;
  const percent = total > 0 && progress ? Math.min(100, Math.round((progress.done / total) * 100)) : 0;
  return (
    <div className="progress-block" role="status" aria-live="polite">
      <label>
        Generating ({percent}%)
        <progress max={100} value={percent} />
      </label>
      {total > 0 && progress && (
        <span className="field-hint">
          {progress.done.toLocaleString("en-US")} of {total.toLocaleString("en-US")} rows
        </span>
      )}
      <button type="button" className="button button-secondary" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
