// The settings of one column (FR-005 to FR-013), opened from its card. Everything here is a change
// the user chooses; nothing is applied silently. Settings that need the data (type, sentinels,
// missing-value markers, a date pattern) are sent to the profile worker; the rest are applied at once.

import { useId, useState } from "react";
import type { DatePatternCheck } from "../../app/session";
import type { LocalEdits } from "../../lib/profile/edits";
import type { ColumnOverrides, ColumnProfile, ColumnType } from "../../lib/profile/types";
import { CellFormatEditor } from "./CellFormatEditor";
import { DatePatternBox } from "./DatePatternBox";
import { ExcludeControl } from "./ExcludeControl";
import type { SampleDescription } from "../../lib/textgen/sample";
import { ChildCountPanel, type TableInfo } from "./ChildCountPanel";
import { IdLinkPanel } from "./IdLinkPanel";
import { IdMaskEditor } from "./IdMaskEditor";
import { PersonalKindEditor } from "./PersonalKindEditor";
import { SamplePreview } from "./SamplePreview";
import { ShortStringEditor } from "./ShortStringEditor";
import { NaTokenEditor } from "./NaTokenEditor";
import { NumericControls } from "./NumericControls";
import { ProtectionsPanel } from "./ProtectionsPanel";
import { SentinelEditor } from "./SentinelEditor";

export interface ColumnEditorsProps {
  profile: ColumnProfile;
  /** Output names of the other columns (a rename must not collide). */
  otherNames: readonly string[];
  /** The worker is profiling this column again. */
  busy: boolean;
  dateCheck: DatePatternCheck | undefined;
  onEdit: (patch: LocalEdits) => void;
  /** What the table is, so another table's spec that uses its IDs can be matched to it. */
  table?: TableInfo;
  onOverride: (patch: Partial<ColumnOverrides>) => void;
  onCheckDate: (pattern: string) => void;
  /** Invented sample values for this column, and how to ask for new ones. */
  samples?: string[];
  onRequestSamples?: (description: SampleDescription) => void;
  /** The columns came from a saved spec, so there is no file to read again. */
  specOnly?: boolean;
  /** The output is an Excel workbook, so the format of the cells can be chosen. */
  workbook?: boolean;
}

/** The types a user can choose. Dates are chosen by typing their pattern; IDs arrive with ID patterns. */
const CHOICES: [string, string][] = [
  ["categorical", "Categorical (coded values)"],
  ["integer", "Integer"],
  ["float", "Decimal number"],
  ["boolean", "Yes / No"],
  ["personal", "Personal data (invented values)"],
  ["free_text", "Free text (lengths only)"],
  ["short_string", "Short string (pattern only)"],
  ["date", "Date or time (type its pattern)"],
  ["unsupported", "Not supported: leave it out"],
];

const isDateLike = (t: ColumnType) => t === "date" || t === "datetime" || t === "time";

export function ColumnEditors({ profile, otherNames, busy, dateCheck, onEdit, table, onOverride, onCheckDate, samples, onRequestSamples, specOnly = false, workbook = false }: ColumnEditorsProps) {
  const typeId = useId();
  const [chooseDate, setChooseDate] = useState(false);
  const kind = profile.summary.kind;
  // A saved spec holds no figures for an unsupported column, so its kind can only change with the file.
  const lockedForSpec = specOnly && profile.type === "unsupported" && profile.summary.kind === "unsupported";
  // A text-like column read as categories or numbers keeps real labels or values in the spec.
  const textLike = profile.detectedType === "personal" || profile.detectedType === "free_text" || profile.detectedType === "short_string";
  const realValuesKept = textLike && ["categorical", "boolean", "integer", "float"].includes(profile.type);

  const selected = isDateLike(profile.type) || chooseDate ? "date" : profile.type;
  const choices = CHOICES.some(([v]) => v === selected) ? CHOICES : [[selected, selected] as [string, string], ...CHOICES];
  const showDate = isDateLike(profile.type) || chooseDate || profile.attentionReasons.some((r) => r.startsWith("date_format"));

  const hasValues = kind !== "empty" && kind !== "unsupported";
  const supportsSentinels = kind === "numeric" || kind === "categorical" || kind === "datetime" || kind === "personal" || kind === "short_string";

  const currentPattern = profile.summary.kind === "datetime" ? (profile.summary.format ?? "") : "";

  return (
    <div className="column-editors" aria-busy={busy}>
      <div className="field">
        <label htmlFor={typeId}>Type</label>
        <select
          id={typeId}
          value={selected}
          disabled={busy || lockedForSpec}
          onChange={(e) => {
            const value = e.target.value;
            if (value === "date") {
              setChooseDate(true);
              return;
            }
            setChooseDate(false);
            onOverride({ type: value as ColumnType, datePattern: undefined });
          }}
        >
          {choices.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {profile.detectedType !== profile.type && <span className="field-hint">Detected as {profile.detectedType.replace("_", " ")}.</span>}
        {busy && <span className="field-hint">Profiling this column again&hellip;</span>}
        {lockedForSpec && <span className="field-hint" data-testid="needs-source-file">Open the original file to change this column&apos;s kind; a saved spec has no figures for it.</span>}
        {realValuesKept && (
          <span className="field-hint" role="note">
            Warning: read this way, real values or labels from this column are kept in the spec file.
          </span>
        )}
      </div>

      {showDate && (
        <DatePatternBox
          column={profile.name}
          current={currentPattern}
          check={dateCheck}
          busy={busy}
          onCheck={onCheckDate}
          onApply={(datePattern) => {
            setChooseDate(false);
            onOverride({ datePattern, type: undefined });
          }}
        />
      )}

      {kind === "personal" && <PersonalKindEditor profile={profile} samples={samples} onEdit={onEdit} onRequestSamples={onRequestSamples} />}
      {kind === "short_string" && <ShortStringEditor profile={profile} samples={samples} onEdit={onEdit} onRequestSamples={onRequestSamples} />}
      {kind === "free_text" && profile.summary.kind === "free_text" && (
        <div className="field">
          <p className="field-hint">
            Only the lengths of the real text are used ({profile.summary.min.toLocaleString("en-US")} to {profile.summary.max.toLocaleString("en-US")} characters). The fake text is made-up filler; no real word is kept. Invented values use plain US English characters, so accents or other scripts are not kept.
          </p>
          <SamplePreview column={profile.name} description={{ kind: "free_text", min: profile.summary.min, max: profile.summary.max }} samples={samples} onRequest={onRequestSamples} />
        </div>
      )}

      {kind === "survey_id" && !profile.idLink && <IdMaskEditor profile={profile} onChange={(idPattern) => onEdit({ idPattern })} />}
      {kind === "survey_id" && <IdLinkPanel profile={profile} onEdit={onEdit} />}
      {table && <ChildCountPanel profile={profile} table={table} onEdit={onEdit} />}

      <ExcludeControl profile={profile} onChange={(exclude) => onEdit({ exclude })} />

      {supportsSentinels && <SentinelEditor profile={profile} busy={busy} onApply={(sentinels) => onOverride({ sentinels })} />}
      {hasValues && <NaTokenEditor profile={profile} busy={busy} onApply={(naTokens) => onOverride({ naTokens })} />}

      {workbook && hasValues && <CellFormatEditor profile={profile} onChange={(cellFormat) => onEdit({ cellFormat })} />}

      <NumericControls
        profile={profile}
        onMode={(mode) => onEdit({ mode })}
        onDecimals={(decimals) => onEdit({ decimals })}
        onRescale={(rescale) => onEdit({ rescale })}
        onCoordinate={(coordinate) => onEdit({ coordinate })}
      />

      <ProtectionsPanel
        profile={profile}
        otherNames={otherNames}
        onMergeUnderK={(mergeUnderK) => onEdit({ mergeUnderK })}
        onLabelCodes={(labelCodes) => onEdit({ labelCodes })}
        onRename={(outputName) => onEdit({ outputName })}
      />
    </div>
  );
}
