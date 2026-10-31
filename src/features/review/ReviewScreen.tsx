// Review: one card per column, with search and filters, the banner of columns that need a look, and
// the controls to override every decision before generating (FR-005 to FR-013, FR-038).

import { useMemo, useState } from "react";
import { FileUp } from "lucide-react";
import { EmptyState } from "../../components/EmptyState";
import type { SessionState } from "../../app/session";
import type { LocalEdits } from "../../lib/profile/edits";
import type { ColumnOverrides } from "../../lib/profile/types";
import { AttentionBanner } from "./AttentionBanner";
import { ColumnCard } from "./ColumnCard";
import { ColumnFilters } from "./ColumnFilters";
import { countByType, filterProfiles, NO_FILTERS, type Filters } from "./filter";
import { SpecContentsNotice } from "./SpecContentsNotice";
import { TextApply } from "./TextApply";

export interface ReviewActions {
  editColumn: (name: string, patch: LocalEdits) => void;
  overrideColumn: (name: string, patch: Partial<ColumnOverrides>) => void;
  checkDatePattern: (name: string, pattern: string) => void;
  setThreshold: (threshold: number) => void;
  onContinue: () => void;
}

export interface ReviewScreenProps {
  session: SessionState;
  actions: ReviewActions;
}

const MIN_THRESHOLD = 2;
const MAX_THRESHOLD = 2000;

export function ReviewScreen({ session, actions }: ReviewScreenProps) {
  const { profiles, rowCount, fileName, phase, progress, busy, reviewError, threshold, datePatternChecks } = session;
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [thresholdText, setThresholdText] = useState(String(threshold));

  const shown = useMemo(() => filterProfiles(profiles, filters), [profiles, filters]);
  const typeCounts = useMemo(() => countByType(profiles), [profiles]);
  const reprofiling = phase === "profiling";

  const typedThreshold = Number(thresholdText);
  const thresholdError =
    thresholdText.trim() === "" || !Number.isInteger(typedThreshold) || typedThreshold < MIN_THRESHOLD || typedThreshold > MAX_THRESHOLD
      ? `Enter a whole number from ${MIN_THRESHOLD} to ${MAX_THRESHOLD.toLocaleString("en-US")}.`
      : null;

  return (
    <section aria-labelledby="review-heading">
      <h2 id="review-heading">Review columns</h2>
      <p className="page-subtitle">
        {fileName}: {rowCount.toLocaleString("en-US")} rows, {profiles.length} columns.
      </p>

      <SpecContentsNotice />

      <div className="review-toolbar">
        <ColumnFilters filters={filters} onChange={setFilters} typeCounts={typeCounts} total={profiles.length} shown={shown.length} />
        <TextApply
          label="Treat columns with up to this many distinct values as categories"
          value={String(threshold)}
          error={thresholdError}
          disabled={reprofiling}
          applyLabel="Profile again"
          hint="Raising it turns more whole-number columns into coded values; lowering it does the opposite."
          onChange={setThresholdText}
          onApply={(text) => actions.setThreshold(Number(text))}
        />
      </div>

      {reprofiling && (
        <div className="progress-block" role="status" aria-live="polite">
          <label>
            Profiling the columns again
            {progress && progress.total > 0 ? ` (${Math.round((progress.done / progress.total) * 100)}%)` : ""}
            <progress max={progress && progress.total > 0 ? progress.total : undefined} value={progress && progress.total > 0 ? progress.done : undefined} />
          </label>
        </div>
      )}

      {reviewError && (
        <div className="banner banner-error" role="alert">
          {reviewError}
        </div>
      )}

      <AttentionBanner profiles={profiles} onlyAttention={filters.attentionOnly} onToggle={() => setFilters({ ...filters, attentionOnly: !filters.attentionOnly })} />

      {shown.length === 0 ? (
        <EmptyState icon={FileUp} message="No columns match these filters." hint="Clear the filters to see every column." />
      ) : (
        <div className="column-grid">
          {shown.map((p) => (
            <ColumnCard
              key={p.name}
              profile={p}
              otherNames={profiles.filter((q) => q.name !== p.name).map((q) => q.outputName)}
              busy={busy.includes(p.name)}
              dateCheck={datePatternChecks[p.name]}
              onEdit={(patch) => actions.editColumn(p.name, patch)}
              onOverride={(patch) => actions.overrideColumn(p.name, patch)}
              onCheckDate={(pattern) => actions.checkDatePattern(p.name, pattern)}
            />
          ))}
        </div>
      )}

      <div className="actions-row">
        <button type="button" className="button button-primary" onClick={actions.onContinue} disabled={reprofiling}>
          Continue to Generate
        </button>
      </div>
    </section>
  );
}
