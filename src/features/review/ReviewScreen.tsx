// Review: a sidebar of columns (search, filters by type, needs attention) beside the detail of the
// selected one, with the controls to override every decision before generating (FR-005 to FR-013,
// FR-038). With nothing selected the right-hand pane is an overview of the whole table.

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { SessionState } from "../../app/session";
import type { LocalEdits } from "../../lib/profile/edits";
import type { RuleSpec } from "../../lib/rules/types";
import { isExcelSettings, type ColumnOverrides } from "../../lib/profile/types";
import type { SampleDescription } from "../../lib/textgen/sample";
import { AttentionBanner } from "./AttentionBanner";
import { CodebookPanel } from "./CodebookPanel";
import { RulesPanel } from "./RulesPanel";
import { ProfileProgress } from "../ingest/ProfileProgress";
import { ColumnCard } from "./ColumnCard";
import { ColumnNav } from "./ColumnNav";
import { countByType, filterProfiles, NO_FILTERS, type Filters } from "./filter";
import { parquetConflict, typeLabel } from "./summary";
import { typeLook } from "./typeIcons";
import { SpecContentsNotice } from "./SpecContentsNotice";
import { TextApply } from "./TextApply";

export interface ReviewActions {
  editColumn: (name: string, patch: LocalEdits) => void;
  overrideColumn: (name: string, patch: Partial<ColumnOverrides>) => void;
  checkDatePattern: (name: string, pattern: string) => void;
  requestSamples: (name: string, description: SampleDescription) => void;
  setThreshold: (threshold: number) => void;
  applyCodebook: (labels: Record<string, Record<string, string>>) => void;
  addRule: (rule: RuleSpec) => string | null;
  removeRule: (index: number) => void;
  onContinue: () => void;
  onSaveSpec: () => void;
}

export interface ReviewScreenProps {
  session: SessionState;
  actions: ReviewActions;
}

const MIN_THRESHOLD = 2;
const MAX_THRESHOLD = 2000;

export function ReviewScreen({ session, actions }: ReviewScreenProps) {
  const {
    profiles,
    rowCount,
    fileName,
    phase,
    progress,
    busy,
    reviewError,
    threshold,
    datePatternChecks,
  } = session;
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [thresholdText, setThresholdText] = useState(String(threshold));
  const [selected, setSelected] = useState<string | null>(null);

  const shown = useMemo(() => filterProfiles(profiles, filters), [profiles, filters]);
  const typeCounts = useMemo(() => countByType(profiles), [profiles]);
  const reprofiling = phase === "profiling";
  const conflicts = profiles.filter((p) => parquetConflict(p)).length;
  const specOnly = session.specOnly;
  const workbook = session.settings !== null && isExcelSettings(session.settings);
  const leftOut = profiles.filter((p) => p.exclude === "drop").length;
  const attention = profiles.filter((p) => p.status !== "ok").length;

  const current = selected === null ? undefined : profiles.find((p) => p.name === selected);
  const index = current ? shown.findIndex((p) => p.name === current.name) : -1;

  const typedThreshold = Number(thresholdText);
  const thresholdError =
    thresholdText.trim() === "" ||
    !Number.isInteger(typedThreshold) ||
    typedThreshold < MIN_THRESHOLD ||
    typedThreshold > MAX_THRESHOLD
      ? `Enter a whole number from ${MIN_THRESHOLD} to ${MAX_THRESHOLD.toLocaleString("en-US")}.`
      : null;

  return (
    <section className="review" aria-labelledby="review-heading">
      <header className="screen-head">
        <div>
          <h2 id="review-heading">Review columns</h2>
          <p className="page-subtitle">
            {fileName}: {rowCount.toLocaleString("en-US")} rows, {profiles.length} columns.
          </p>
        </div>
        <div className="screen-actions">
          <button type="button" className="button button-secondary" onClick={actions.onSaveSpec}>
            Save spec (JSON)
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={actions.onContinue}
            disabled={reprofiling || conflicts > 0}
          >
            Continue to Generate
          </button>
        </div>
      </header>

      {specOnly && (
        <div className="banner banner-info" role="status">
          {session.designed
            ? "Designed in this app: there is no source file. You can change settings that need no data here, and the columns themselves in Design."
            : "Loaded from a saved spec: there is no source file open. You can still change settings that need no data, and generate."}
        </div>
      )}

      {reprofiling && <ProfileProgress progress={progress} label="Profiling the columns again" />}

      {reviewError && (
        <div className="banner banner-error" role="alert">
          {reviewError}
        </div>
      )}

      {conflicts > 0 && (
        <div className="banner banner-error" role="alert" data-testid="parquet-conflicts">
          {conflicts} {conflicts === 1 ? "column has" : "columns have"} a type that its Parquet
          column cannot hold. Fix {conflicts === 1 ? "it" : "them"} before generating.
        </div>
      )}

      <div className="review-panes">
        <ColumnNav
          shown={shown}
          total={profiles.length}
          rowCount={rowCount}
          filters={filters}
          onFilters={setFilters}
          typeCounts={typeCounts}
          selected={current ? current.name : null}
          onSelect={setSelected}
        />

        <div className="review-detail">
          {current ? (
            <>
              <ColumnCard
                key={current.name}
                profile={current}
                otherNames={profiles
                  .filter((q) => q.name !== current.name)
                  .map((q) => q.outputName)}
                busy={busy.includes(current.name)}
                dateCheck={datePatternChecks[current.name]}
                onEdit={(patch) => actions.editColumn(current.name, patch)}
                onOverride={(patch) => actions.overrideColumn(current.name, patch)}
                onCheckDate={(pattern) => actions.checkDatePattern(current.name, pattern)}
                samples={session.samples[current.name]}
                onRequestSamples={(description) =>
                  actions.requestSamples(current.name, description)
                }
                specOnly={specOnly}
                workbook={workbook}
              />
              <div className="detail-nav">
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={index <= 0}
                  onClick={() => setSelected(shown[index - 1].name)}
                >
                  <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" /> Previous column
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={index < 0 || index >= shown.length - 1}
                  onClick={() => setSelected(shown[index + 1].name)}
                >
                  Next column <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
                {index < 0 && (
                  <span className="field-hint">This column is hidden by the filters.</span>
                )}
              </div>
            </>
          ) : (
            <div className="overview">
              <h3>Overview</h3>
              <p className="overview-lead">Pick a column to see how it will be faked.</p>
              <dl className="overview-stats">
                <div>
                  <dt>Columns</dt>
                  <dd>{profiles.length}</dd>
                </div>
                <div>
                  <dt>Need a look</dt>
                  <dd>{attention}</dd>
                </div>
                <div>
                  <dt>Left out</dt>
                  <dd>{leftOut}</dd>
                </div>
                <div>
                  <dt>Rows</dt>
                  <dd>{rowCount.toLocaleString("en-US")}</dd>
                </div>
              </dl>

              <h4 className="overview-subhead">Column types</h4>
              <ul className="type-legend">
                {Object.keys(typeCounts)
                  .sort((a, b) => typeLabel(a).localeCompare(typeLabel(b)))
                  .map((t) => {
                    const look = typeLook(t);
                    const Icon = look.icon;
                    return (
                      <li key={t}>
                        <button type="button" onClick={() => setFilters({ ...filters, type: t })}>
                          <Icon
                            size={16}
                            strokeWidth={1.75}
                            style={{ color: look.color }}
                            aria-hidden="true"
                          />
                          <span>{typeLabel(t)}</span>
                          <span className="type-legend-count">{typeCounts[t]}</span>
                        </button>
                      </li>
                    );
                  })}
              </ul>

              <AttentionBanner
                profiles={profiles}
                onlyAttention={filters.attentionOnly}
                onToggle={() => setFilters({ ...filters, attentionOnly: !filters.attentionOnly })}
              />

              <TextApply
                label="Treat columns with up to this many distinct values as categories"
                value={String(threshold)}
                error={thresholdError}
                disabled={reprofiling || specOnly}
                applyLabel="Profile again"
                hint="Raising it turns more whole-number columns into coded values; lowering it does the opposite."
                onChange={setThresholdText}
                onApply={(text) => actions.setThreshold(Number(text))}
              />

              <RulesPanel
                profiles={profiles}
                rules={session.rules}
                onAdd={actions.addRule}
                onRemove={actions.removeRule}
              />

              <CodebookPanel profiles={profiles} onApply={actions.applyCodebook} />

              <SpecContentsNotice />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
