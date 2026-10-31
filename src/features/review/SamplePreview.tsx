// A few invented values for a column, so the user can judge a kind or a pattern before generating
// (specs/002 FR-010). The values come from the generating worker and are made up, never taken from the
// user's data. The request is repeated whenever the description changes.

import { useEffect, useRef } from "react";
import type { SampleDescription } from "../../lib/textgen/sample";

export interface SamplePreviewProps {
  column: string;
  /** What to sample; null when there is nothing to show yet (for example an unacknowledged SSN-style column). */
  description: SampleDescription | null;
  samples: string[] | undefined;
  onRequest: ((description: SampleDescription) => void) | undefined;
}

export function SamplePreview({ column, description, samples, onRequest }: SamplePreviewProps) {
  const key = description ? JSON.stringify(description) : "";
  const request = useRef(onRequest);
  request.current = onRequest;
  useEffect(() => {
    if (description) request.current?.(description);
    // The key stands for the description: ask again only when its content changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!description) return null;
  return (
    <p className="field-hint sample-preview" data-testid={`sample-${column}`} aria-live="polite">
      Examples (invented): {samples && samples.length > 0 ? samples.map((s) => <span key={s} className="sample-value">{s.replace(/\n/g, " ⏎ ")}</span>) : "loading…"}
    </p>
  );
}
