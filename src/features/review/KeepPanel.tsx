// "What should the fake column keep from the real one?" (specs/032): the choices that matter for each kind of column, in plain words,
// each with what it gives away. The settings that rarely matter are in the Advanced section below it. A choice only ever coarsens a
// summary the profile already holds; the spec then holds the coarser figure, never the real one.

import "./Keep.css";
import { useId, type ReactNode } from "react";
import { InfoTip } from "../../components/InfoTip";
import { canChangeMissing, roundRange, roundingUnit, type CountsKeep, type MissingKeep, type NumberShape, type RangeKeep } from "../../lib/keep/keep";
import { MAX_DECIMALS, type LocalEdits } from "../../lib/profile/edits";
import type { ColumnProfile, NumericMode } from "../../lib/profile/types";

export interface KeepPanelProps {
  profile: ColumnProfile;
  rows: number;
  onEdit: (patch: LocalEdits) => void;
}

function Choice<T extends string>({
  legend,
  help,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  help?: ReactNode;
  name: string;
  value: T;
  options: { value: T; label: string; note: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="keep-group">
      <legend>
        {legend}
        {help && <InfoTip label={`About ${legend.toLowerCase()}`}>{help}</InfoTip>}
      </legend>
      {options.map((o) => (
        <label key={o.value} className={`keep-option ${value === o.value ? "keep-option--on" : ""}`}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span className="keep-option-text">
            <span className="keep-option-label">{o.label}</span>
            <span className="keep-option-note">{o.note}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

const fmt = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 6 });

/** A date or time written the way the column's kind shows it, for the range preview. */
function rangeLabel(type: string, n: number): string {
  if (type === "date") return new Date(n * 86_400_000).toISOString().slice(0, 10);
  if (type === "datetime") return new Date(n * 1000).toISOString().slice(0, 10);
  if (type === "time") return `${String(Math.floor(n / 3600)).padStart(2, "0")}:00`;
  return fmt(n);
}

export function KeepPanel({ profile, rows, onEdit }: KeepPanelProps) {
  const id = useId();
  const s = profile.summary;
  const keep = profile.keep ?? {};
  const unit = roundingUnit(rows);
  const sharePct = Math.max(1, Math.round((unit / Math.max(1, rows)) * 100));

  if (profile.fromParent || profile.exclude !== "include") return null;

  const missingChoice = canChangeMissing(profile.type) && profile.naCount > 0 && (
    <Choice<MissingKeep>
      legend="Rows with no value"
      name={`${id}-missing`}
      value={keep.missing ?? "exact"}
      help="How many rows of the fake column are left empty. A missing-value count is a figure from your data."
      onChange={(missing) => onEdit({ keep: { missing } })}
      options={[
        { value: "exact", label: "The same number as the real data", note: `${profile.naCount.toLocaleString("en-US")} rows. Reveals the exact count.` },
        { value: "rounded", label: "About the same", note: `Rounded to the nearest ${unit.toLocaleString("en-US")} rows. Close enough for most tests.` },
        { value: "none", label: "None", note: "Every row gets a value. Code that handles missing values will not be exercised." },
      ]}
    />
  );

  if (s.kind === "categorical" && (profile.type === "categorical" || profile.type === "boolean")) {
    return (
      <section className="keep-panel" aria-label="What to keep" data-testid="keep-panel">
        <p className="field-hint">Every label is kept as it is unless you group the very small ones or hide the names.</p>
        <Choice<CountsKeep>
          legend="How often each label appears"
          name={`${id}-counts`}
          value={keep.counts ?? "exact"}
          help="A label with only a few rows can point at a person. Rounding or equal shares keep the labels and drop the real counts from the spec."
          onChange={(counts) => onEdit({ keep: { counts } })}
          options={[
            { value: "exact", label: "Exactly as in the real data", note: "Reveals the exact count of every label." },
            { value: "rounded", label: "Roughly", note: `Rounded to about ${sharePct}% of the rows (${unit.toLocaleString("en-US")} rows). The shares stay close.` },
            { value: "equal", label: "Equally", note: "The same number of rows for every label. Reveals nothing about the real shares." },
          ]}
        />
        {missingChoice}
        <fieldset className="keep-group">
          <legend>Label names</legend>
          <div className="field">
            <span className="label-row">
              <label htmlFor={`${id}-merge`}>Group very small labels as &ldquo;Other&rdquo; (fewer than this many rows)</label>
              <InfoTip label="More information">Leave blank to keep every label. Rare labels can identify a person.</InfoTip>
            </span>
            <input
              id={`${id}-merge`}
              type="number"
              min={2}
              step={1}
              placeholder="off"
              value={profile.mergeUnderK ? String(profile.mergeUnderK) : ""}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") return onEdit({ mergeUnderK: null });
                const k = Number(raw);
                if (Number.isInteger(k) && k >= 2) onEdit({ mergeUnderK: k });
              }}
            />
          </div>
          <div className="field">
            <span className="label-row">
              <label htmlFor={`${id}-codes`}>
                <input id={`${id}-codes`} type="checkbox" checked={profile.labelCodes === true} onChange={(e) => onEdit({ labelCodes: e.target.checked })} /> Hide label names (use cat_01, cat_02, &hellip;)
              </label>
              <InfoTip label="More information">Analysis code that filters on exact labels will need updating before you switch to the real file.</InfoTip>
            </span>
          </div>
        </fieldset>
      </section>
    );
  }

  if ((s.kind === "numeric" || s.kind === "datetime") && !profile.coordinate) {
    const type = profile.type;
    const rounded = roundRange(type, s.min, s.max, s.decimals);
    const unitWord = type === "date" ? "whole months" : type === "datetime" ? "whole days" : type === "time" ? "whole hours" : "two significant digits";
    const mode: NumericMode = profile.mode ?? "match_mean_sd";
    return (
      <section className="keep-panel" aria-label="What to keep" data-testid="keep-panel">
        <Choice<RangeKeep>
          legend="Lowest and highest value"
          name={`${id}-range`}
          value={keep.range ?? "exact"}
          help="The lowest and highest values are single real values, and an extreme can point at one person."
          onChange={(range) => onEdit({ keep: { range } })}
          options={[
            { value: "exact", label: "Exactly as in the real data", note: `${rangeLabel(type, s.min)} to ${rangeLabel(type, s.max)}. Reveals both extremes.` },
            { value: "rounded", label: "Widened a little", note: `${rangeLabel(type, rounded.min)} to ${rangeLabel(type, rounded.max)} (${unitWord}). The extremes stay hidden.` },
          ]}
        />
        <Choice<NumberShape>
          legend="Shape of the values"
          name={`${id}-shape`}
          value={mode as NumberShape}
          help="How the values are spread between the lowest and the highest."
          onChange={(shape) => onEdit({ mode: shape })}
          options={[
            { value: "match_shape", label: "The same shape", note: "Keeps peaks and skew, from 101 percentiles. Reveals the most." },
            { value: "match_mean_sd", label: "The same average and spread", note: "Keeps the mean and standard deviation only." },
            { value: "uniform", label: "Evenly spread", note: "Every value between the lowest and highest is equally likely. Reveals nothing about the shape." },
          ]}
        />
        <div className="field keep-rescale">
          <span className="label-row">
            <label htmlFor={`${id}-rescale`}>
              <input id={`${id}-rescale`} type="checkbox" checked={profile.rescale === true} disabled={mode !== "match_mean_sd"} onChange={(e) => onEdit({ rescale: e.target.checked })} /> Make the average and spread match exactly
            </label>
            <InfoTip label="More information">Off by default. Moves a few values so the fake column matches; the lowest and highest values stay exact.</InfoTip>
          </span>
        </div>
        {missingChoice}
        {profile.type === "float" && s.kind === "numeric" && (
          <div className="field keep-decimals">
            <label htmlFor={`${id}-decimals`}>Decimal places</label>
            <input
              id={`${id}-decimals`}
              type="number"
              min={0}
              max={MAX_DECIMALS}
              step={1}
              value={s.decimals}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (e.target.value !== "" && Number.isFinite(n)) onEdit({ decimals: n });
              }}
            />
          </div>
        )}
      </section>
    );
  }

  const note: Partial<Record<ColumnProfile["summary"]["kind"], string>> = {
    personal: "Nothing from the real values is kept. The fake values are invented; only the kind of data and how often values repeat are followed.",
    free_text: "Only the length of the real text is kept. The fake text is made-up filler.",
    short_string: "Only the pattern of characters and the lengths are kept, never a value.",
    survey_id: "The IDs are invented to the pattern below. Only how often an ID repeats is followed, never an ID.",
    numeric: "A coordinate keeps only its bounding box and decimal places; the values are spread evenly inside it.",
    empty: "This column is empty in the real data, so the fake column is empty too.",
  };
  const text = note[s.kind];
  return text ? (
    <section className="keep-panel keep-panel--note" aria-label="What to keep" data-testid="keep-panel">
      <p className="keep-note">{text}</p>
    </section>
  ) : null;
}
