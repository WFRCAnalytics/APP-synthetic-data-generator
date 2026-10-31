// Review: one card per column. This first version shows what the profiler found; the controls to
// override each decision arrive with User Story 2.

import { TriangleAlert } from "lucide-react";
import type { ColumnProfile } from "../../lib/profile/types";
import { ColumnCard } from "./ColumnCard";

export interface ReviewScreenProps {
  profiles: ColumnProfile[];
  rowCount: number;
  fileName: string;
  onContinue: () => void;
}

export function ReviewScreen({ profiles, rowCount, fileName, onContinue }: ReviewScreenProps) {
  const attention = profiles.filter((p) => p.status !== "ok");
  const left = profiles.filter((p) => p.exclude === "drop").length;

  return (
    <section aria-labelledby="review-heading">
      <h2 id="review-heading">Review columns</h2>
      <p className="page-subtitle">
        {fileName}: {rowCount.toLocaleString("en-US")} rows, {profiles.length} columns.
      </p>

      {attention.length > 0 && (
        <div className="banner banner-warning" role="status">
          <TriangleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
          <span>
            {attention.length} {attention.length === 1 ? "column needs" : "columns need"} a look
            {left > 0 ? `; ${left} will be left out of the fake file` : ""}.
          </span>
        </div>
      )}

      <div className="column-grid">
        {profiles.map((p) => (
          <ColumnCard key={p.name} profile={p} />
        ))}
      </div>

      <div className="actions-row">
        <button type="button" className="button button-primary" onClick={onContinue}>
          Continue to Generate
        </button>
      </div>
    </section>
  );
}
