// How a numeric column's values are generated (FR-011): spread evenly, match the mean and spread,
// or match the shape (percentiles); decimal places; and the optional rescale (FR-027).

import { useId } from "react";
import { fitBeta } from "../../lib/sampling";
import { MAX_DECIMALS } from "../../lib/profile/edits";
import type { ColumnProfile, NumericMode } from "../../lib/profile/types";

export interface NumericControlsProps {
  profile: ColumnProfile;
  onMode: (mode: NumericMode) => void;
  onDecimals: (decimals: number) => void;
  onRescale: (on: boolean) => void;
}

export function NumericControls({ profile, onMode, onDecimals, onRescale }: NumericControlsProps) {
  const id = useId();
  const s = profile.summary;
  if (s.kind !== "numeric" && s.kind !== "datetime") return null;

  const mode: NumericMode = profile.mode ?? "match_mean_sd";
  const canFit = fitBeta(s.mean, s.sd, s.min, s.max) !== null;

  return (
    <fieldset className="editor-group">
      <legend>How values are generated</legend>

      <div className="field">
        <label htmlFor={`${id}-mode`}>Numeric mode</label>
        <select id={`${id}-mode`} value={mode} onChange={(e) => onMode(e.target.value as NumericMode)}>
          <option value="uniform">Spread evenly between the minimum and maximum</option>
          <option value="match_mean_sd">Match the mean and spread</option>
          <option value="match_shape">Match the shape (keeps peaks and skew)</option>
        </select>
        {mode === "match_mean_sd" && !canFit && (
          <span className="field-hint">The mean and spread cannot be matched on this range, so values are spread evenly.</span>
        )}
      </div>

      {profile.type === "float" && s.kind === "numeric" && (
        <div className="field">
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
              if (e.target.value !== "" && Number.isFinite(n)) onDecimals(n);
            }}
          />
          <span className="field-hint">0 to {MAX_DECIMALS}.</span>
        </div>
      )}

      <div className="field">
        <label htmlFor={`${id}-rescale`}>
          <input id={`${id}-rescale`} type="checkbox" checked={profile.rescale === true} disabled={mode !== "match_mean_sd"} onChange={(e) => onRescale(e.target.checked)} /> Restore the exact mean and spread after rounding
        </label>
        <span className="field-hint">Off by default. Moves a few values so the fake column matches; the minimum and maximum stay exact.</span>
      </div>
    </fieldset>
  );
}
