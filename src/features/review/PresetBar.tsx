// One choice for the whole table: how closely the fake table follows the real data. It sets what every column keeps; any column can
// still be changed on its own, after which the bar reads "Custom".

import "./Keep.css";
import { Gauge } from "lucide-react";
import { PRESETS, type Preset } from "../../lib/keep/keep";

export interface PresetBarProps {
  value: Preset | "custom";
  onChange: (preset: Preset) => void;
}

export function PresetBar({ value, onChange }: PresetBarProps) {
  const current = PRESETS.find((p) => p.id === value);
  return (
    <section className="preset-bar" aria-label="How closely the fake table follows your data" data-testid="preset-bar">
      <div className="preset-bar-head">
        <Gauge size={18} strokeWidth={1.75} aria-hidden="true" />
        <h3>How closely should the fake table follow your data?</h3>
      </div>
      <div className="preset-options" role="radiogroup" aria-label="Preset">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={value === p.id} className={`preset-option ${value === p.id ? "preset-option--on" : ""}`} onClick={() => onChange(p.id)}>
            {p.label}
          </button>
        ))}
        {value === "custom" && (
          <span className="preset-custom" data-testid="preset-custom">
            Custom: changed on individual columns
          </span>
        )}
      </div>
      <p className="field-hint">{current ? current.note : "Pick a preset to set every column again, or keep your own choices column by column."}</p>
    </section>
  );
}
