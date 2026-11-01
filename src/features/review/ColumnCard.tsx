// The detail of one column (FR-009): name, detected type, status, a few facts, a small chart, why it
// needs a look, and every automatic decision as a setting the user can change. It fills the right-hand
// pane of Review; the list of columns is the sidebar (ColumnNav).

import { Badge } from "../../components/Badge";
import type { DatePatternCheck } from "../../app/session";
import type { LocalEdits } from "../../lib/profile/edits";
import type { ColumnOverrides, ColumnProfile } from "../../lib/profile/types";
import type { SampleDescription } from "../../lib/textgen/sample";
import { UNSUPPORTED_TEXT } from "../../lib/parquet/types";
import { ColumnEditors } from "./ColumnEditors";
import { Sparkline } from "./Sparkline";
import { parquetConflict, reasonText, sparkBars, summaryLines, typeLabel } from "./summary";
import { typeLook } from "./typeIcons";

export interface ColumnCardProps {
  profile: ColumnProfile;
  /** Output names of the other columns. */
  otherNames: readonly string[];
  busy?: boolean;
  dateCheck?: DatePatternCheck;
  onEdit?: (patch: LocalEdits) => void;
  onOverride?: (patch: Partial<ColumnOverrides>) => void;
  onCheckDate?: (pattern: string) => void;
  samples?: string[];
  onRequestSamples?: (description: SampleDescription) => void;
  specOnly?: boolean;
  workbook?: boolean;
}

const noop = () => {};

export function ColumnCard({ profile, otherNames, busy = false, dateCheck, onEdit = noop, onOverride = noop, onCheckDate = noop, samples, onRequestSamples, specOnly, workbook }: ColumnCardProps) {
  const dropped = profile.exclude === "drop";
  const bars = sparkBars(profile);
  const lines = summaryLines(profile);
  const look = typeLook(profile.type);
  const Icon = look.icon;

  return (
    <article className="column-card" data-column={profile.name} data-status={profile.status} aria-busy={busy} aria-labelledby="column-detail-name">
      <header className="column-card-header">
        <span className="type-tile" style={{ color: look.color }} aria-hidden="true">
          <Icon size={22} strokeWidth={1.75} />
        </span>
        <div className="column-card-title">
          <h3 id="column-detail-name" className="column-card-name">
            {profile.name}
          </h3>
          {profile.outputName !== profile.name && <p className="column-card-renamed">Written as {profile.outputName}</p>}
          <div className="column-card-badges">
            <Badge variant={profile.type === "unsupported" ? "danger" : "info"}>{typeLabel(profile.type)}</Badge>
            {profile.status === "needs_attention" && <Badge variant="warning">Needs attention</Badge>}
            {dropped && <Badge variant="neutral">Left out</Badge>}
            {profile.exclude === "keep_as_na" && <Badge variant="neutral">Kept as all-missing</Badge>}
          </div>
        </div>
      </header>

      <div className="column-card-body">
        <ul className="column-card-facts">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <Sparkline bars={bars} label={`Distribution of ${profile.name}`} />
      </div>

      {parquetConflict(profile) && (
        <p className="field-hint field-error" role="alert" data-testid="parquet-conflict">
          {parquetConflict(profile)} Change the type back, or leave this column out.
        </p>
      )}

      {profile.attentionReasons.length > 0 && (
        <ul className="column-card-reasons">
          {profile.attentionReasons.map((code) => (
            <li key={code}>{code === "unsupported_type" && profile.unsupportedReason ? UNSUPPORTED_TEXT[profile.unsupportedReason] : reasonText(code)}</li>
          ))}
        </ul>
      )}

      <section className="column-card-settings" aria-label={`Settings for ${profile.name}`}>
        <h4 className="column-card-settings-title">Settings</h4>
        <ColumnEditors profile={profile} otherNames={otherNames} busy={busy} dateCheck={dateCheck} onEdit={onEdit} onOverride={onOverride} onCheckDate={onCheckDate} samples={samples} onRequestSamples={onRequestSamples} specOnly={specOnly} workbook={workbook} />
      </section>
    </article>
  );
}
