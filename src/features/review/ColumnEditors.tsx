// The settings of one column (FR-005 to FR-013), as four collapsible groups in the order a person thinks (specs/033):
//   1. How the app read the column: its type, a date pattern, a coordinate, missing words and special codes. Opens by itself when something needs a look.
//   2. What the fake column keeps: the choices that matter for its kind. Always open.
//   3. How it is written in the fake file: its name, whether it is included, an Excel format.
//   4. Connect to another table: shown only where it can apply.
// Settings that need the data (type, special codes, missing words, a date pattern) are sent to the profile worker; the rest apply at once.

import { Cable, FileOutput, ScanSearch, SlidersHorizontal } from "lucide-react";
import { useId, useState } from "react";
import type { DatePatternCheck } from "../../app/session";
import { validateOutputName } from "../../lib/protections";
import { EMPTY_TEXT_TOKEN } from "../../lib/spec/types";
import type { LocalEdits } from "../../lib/profile/edits";
import type { ColumnOverrides, ColumnProfile, ColumnType } from "../../lib/profile/types";
import type { SampleDescription } from "../../lib/textgen/sample";
import { CellFormatEditor } from "./CellFormatEditor";
import { ChildCountPanel, type TableInfo } from "./ChildCountPanel";
import { ColumnGroup } from "./ColumnGroup";
import { CoordinateControl } from "./CoordinateControl";
import { DatePatternBox } from "./DatePatternBox";
import { ExcludeControl } from "./ExcludeControl";
import { IdLinkPanel } from "./IdLinkPanel";
import { IdMaskEditor } from "./IdMaskEditor";
import { KeepPanel } from "./KeepPanel";
import { NaTokenEditor } from "./NaTokenEditor";
import { ParentValuePanel } from "./ParentValuePanel";
import { PersonalKindEditor } from "./PersonalKindEditor";
import { SamplePreview } from "./SamplePreview";
import { SentinelEditor } from "./SentinelEditor";
import { ShortStringEditor } from "./ShortStringEditor";
import { TextApply } from "./TextApply";
import { canConnect, connectSummary, keepSummary, readNeedsLook, readOpensByDefault, readSummary, writeSummary } from "./groupSummary";

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
  /** Which groups the person has opened or closed on this column, kept while they look at other columns. */
  groups?: Record<string, boolean>;
  onGroup?: (group: string, open: boolean) => void;
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

export function ColumnEditors({ profile, otherNames, busy, dateCheck, onEdit, table, onOverride, onCheckDate, samples, onRequestSamples, specOnly = false, workbook = false, groups = {}, onGroup = () => {} }: ColumnEditorsProps) {
  const typeId = useId();
  const [chooseDate, setChooseDate] = useState(false);
  const [nameText, setNameText] = useState(profile.outputName);
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

  const nameError = nameText === profile.outputName ? null : validateOutputName(nameText, otherNames);
  const blank = profile.naByToken[""] ?? 0;
  const codes = Object.entries(profile.sentinels);
  const found = [
    blank > 0 ? `${blank.toLocaleString("en-US")} blank` : null,
    ...Object.entries(profile.naByToken)
      .filter(([t]) => t !== "")
      .map(([t, c]) => `${c.toLocaleString("en-US")} marked ${t === EMPTY_TEXT_TOKEN ? "empty text" : t}`),
    codes.length > 0 ? `special codes ${codes.map(([c, n]) => `${c} (${n.toLocaleString("en-US")})`).join(", ")}` : null,
  ].filter(Boolean);

  const open = (id: string, otherwise: boolean) => groups[id] ?? otherwise;
  const readLook = readNeedsLook(profile);
  const connectable = canConnect(profile, table);

  return (
    <div className={`column-editors ${profile.exclude === "include" ? "" : "cg-off"}`} aria-busy={busy}>
      <ColumnGroup id="read" icon={ScanSearch} title="How the app read this column" summary={readSummary(profile)} open={open("read", readOpensByDefault(profile))} onToggle={(o) => onGroup("read", o)} attention={readLook}>
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
          {lockedForSpec && (
            <span className="field-hint" data-testid="needs-source-file">
              Open the original file to change this column&apos;s kind; a saved spec has no figures for it.
            </span>
          )}
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

        <CoordinateControl profile={profile} onCoordinate={(coordinate) => onEdit({ coordinate })} />

        {hasValues && (
          <fieldset className="editor-group">
            <legend>Missing and special values</legend>
            {found.length > 0 && (
              <p className="cg-found" data-testid="missing-found">
                Found: {found.join("; ")}.
              </p>
            )}
            {supportsSentinels && <SentinelEditor profile={profile} busy={busy} onApply={(sentinels) => onOverride({ sentinels })} />}
            <NaTokenEditor profile={profile} busy={busy} onApply={(naTokens) => onOverride({ naTokens })} />
          </fieldset>
        )}
      </ColumnGroup>

      <ColumnGroup id="keep" icon={SlidersHorizontal} title="What the fake column keeps" summary={keepSummary(profile)} open={open("keep", true)} onToggle={(o) => onGroup("keep", o)}>
        <KeepPanel profile={profile} rows={table?.rows ?? 0} onEdit={onEdit} />

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
      </ColumnGroup>

      <ColumnGroup id="write" icon={FileOutput} title="How it is written in the fake file" summary={writeSummary(profile, workbook)} open={open("write", false)} onToggle={(o) => onGroup("write", o)}>
        <TextApply
          label="Name in the fake file"
          value={profile.outputName}
          error={nameError}
          hint="Renames the column in the fake file only. Code written against it will use the new name."
          onChange={setNameText}
          onApply={(text) => {
            if (validateOutputName(text, otherNames) === null) onEdit({ outputName: text });
          }}
          applyLabel="Rename"
        />
        <ExcludeControl profile={profile} onChange={(exclude) => onEdit({ exclude })} />
        {workbook && hasValues && <CellFormatEditor profile={profile} onChange={(cellFormat) => onEdit({ cellFormat })} />}
      </ColumnGroup>

      {connectable && (
        <ColumnGroup id="connect" icon={Cable} title="Connect to another table" summary={connectSummary(profile)} open={open("connect", false)} onToggle={(o) => onGroup("connect", o)}>
          <p className="field-hint">Only needed when you make several tables that must join, such as households and persons.</p>
          {kind === "survey_id" && <IdLinkPanel profile={profile} onEdit={onEdit} />}
          {table && <ChildCountPanel profile={profile} table={table} onEdit={onEdit} />}
          {table && <ParentValuePanel profile={profile} table={table} onEdit={onEdit} />}
        </ColumnGroup>
      )}
    </div>
  );
}
