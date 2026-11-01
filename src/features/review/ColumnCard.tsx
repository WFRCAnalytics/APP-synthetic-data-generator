// One card per column (FR-009): name, detected type, status, a few facts, a small chart, and a
// "Settings" section where every automatic decision can be changed.

import { useState } from "react";
import { Badge } from "../../components/Badge";
import type { DatePatternCheck } from "../../app/session";
import type { LocalEdits } from "../../lib/profile/edits";
import type { ColumnOverrides, ColumnProfile } from "../../lib/profile/types";
import type { SampleDescription } from "../../lib/textgen/sample";
import { UNSUPPORTED_TEXT } from "../../lib/parquet/types";
import { ColumnEditors } from "./ColumnEditors";
import { Sparkline } from "./Sparkline";
import { reasonText, sparkBars, summaryLines, typeLabel } from "./summary";

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
  // The settings are only built while open, so a hundred cards stay light.
  const [open, setOpen] = useState(false);
  const dropped = profile.exclude === "drop";
  const bars = sparkBars(profile);
  const lines = summaryLines(profile);

  return (
    <article className="card column-card" data-column={profile.name} data-status={profile.status} aria-busy={busy}>
      <header className="column-card-header">
        <h3 className="column-card-name">{profile.name}</h3>
        {profile.outputName !== profile.name && <p className="column-card-renamed">Written as {profile.outputName}</p>}
        <div className="column-card-badges">
          <Badge variant={profile.type === "unsupported" ? "danger" : "info"}>{typeLabel(profile.type)}</Badge>
          {profile.status === "needs_attention" && <Badge variant="warning">Needs attention</Badge>}
          {dropped && <Badge variant="neutral">Left out</Badge>}
          {profile.exclude === "keep_as_na" && <Badge variant="neutral">Kept as all-missing</Badge>}
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

      {profile.attentionReasons.length > 0 && (
        <ul className="column-card-reasons">
          {profile.attentionReasons.map((code) => (
            <li key={code}>{code === "unsupported_type" && profile.unsupportedReason ? UNSUPPORTED_TEXT[profile.unsupportedReason] : reasonText(code)}</li>
          ))}
        </ul>
      )}

      <details className="column-card-settings" open={open}>
        {/* The open state is explicit so the settings are built only when shown, and it works the same
            with a keyboard (Enter or Space on the summary) as with a click. */}
        <summary
          aria-expanded={open}
          onClick={(e) => {
            e.preventDefault();
            setOpen(!open);
          }}
        >
          Settings
        </summary>
        {open && (
          <ColumnEditors profile={profile} otherNames={otherNames} busy={busy} dateCheck={dateCheck} onEdit={onEdit} onOverride={onOverride} onCheckDate={onCheckDate} samples={samples} onRequestSamples={onRequestSamples} specOnly={specOnly} workbook={workbook} />
        )}
      </details>
    </article>
  );
}
