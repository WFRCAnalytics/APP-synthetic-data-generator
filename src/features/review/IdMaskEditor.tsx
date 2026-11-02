// The ID pattern editor (FR-016): each position of a survey ID is a kind of character or a fixed one,
// with a live sample of invented IDs and what the pattern allows against what the column needs.
// Nothing here holds a real ID; the pattern came from lengths and character classes only.

import { X } from "lucide-react";
import { useId, useState } from "react";
import { sampleIds } from "../../lib/generate/survey-id";
import { isLiteral, isNumericMask } from "../../lib/mask/mask";
import { idFit, shortfallText } from "../../lib/profile/idCapacity";
import type { IdPattern } from "../../lib/profile/edits";
import type { ColumnProfile, MaskToken } from "../../lib/profile/types";

export interface IdMaskEditorProps {
  profile: ColumnProfile;
  /** A new pattern, or undefined to go back to the detected one. */
  onChange: (pattern: IdPattern | undefined) => void;
}

const KINDS: [string, string][] = [
  ["digit", "Digit"],
  ["upper", "Capital letter"],
  ["lower", "Lowercase letter"],
  ["letter", "Any letter"],
  ["alnum", "Letter or digit"],
  ["literal", "Fixed character"],
];

const kindOf = (t: MaskToken): string => (isLiteral(t) ? "literal" : t);
const asNumber = (text: string): number | undefined =>
  text.trim() !== "" && Number.isInteger(Number(text)) ? Number(text) : undefined;

export function IdMaskEditor({ profile, onChange }: IdMaskEditorProps) {
  const id = useId();
  const s = profile.summary;
  const [minText, setMinText] = useState<string | null>(null);
  const [maxText, setMaxText] = useState<string | null>(null);
  if (s.kind !== "survey_id") return null;

  const pattern: IdPattern = { mask: s.mask, min: s.min, max: s.max, pad: s.padWidth };
  const numeric = isNumericMask(s.mask);
  const fit = idFit(profile);
  const sample = sampleIds(s.mask, 5, s.min, s.max, s.padWidth);

  const setMask = (mask: MaskToken[]) => {
    // A range only applies to whole-number patterns.
    const keep = isNumericMask(mask);
    onChange({
      mask,
      min: keep ? pattern.min : undefined,
      max: keep ? pattern.max : undefined,
      pad: keep ? pattern.pad : 0,
    });
  };
  const setToken = (i: number, kind: string) => {
    const next = [...s.mask];
    next[i] = kind === "literal" ? { literal: "-" } : (kind as MaskToken);
    setMask(next);
  };

  return (
    <fieldset className="id-mask-editor" data-id-mask-for={profile.name}>
      <legend>ID pattern</legend>
      <ol className="id-mask-positions">
        {s.mask.map((t, i) => (
          <li key={i}>
            <select
              aria-label={`Position ${i + 1}`}
              value={kindOf(t)}
              onChange={(e) => setToken(i, e.target.value)}
            >
              {KINDS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {isLiteral(t) && (
              <input
                aria-label={`Fixed character at position ${i + 1}`}
                className="id-mask-literal"
                value={t.literal}
                onChange={(e) => {
                  if (e.target.value === "") return;
                  // One character per position: typing replaces it (the last character typed wins).
                  const next = [...s.mask];
                  next[i] = { literal: Array.from(e.target.value).slice(-1)[0] };
                  setMask(next);
                }}
              />
            )}
            <button
              type="button"
              className="id-mask-remove"
              title="Remove this position"
              aria-label={`Remove position ${i + 1}`}
              onClick={() => setMask(s.mask.filter((_, j) => j !== i))}
            >
              <X size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
      <div className="actions-row">
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setMask([...s.mask, "digit"])}
        >
          Add position
        </button>
        <button type="button" className="button-link" onClick={() => onChange(undefined)}>
          Reset to detected
        </button>
      </div>

      {numeric && (
        <div className="settings-grid">
          <div className="field">
            <label htmlFor={`${id}-min`}>Lowest number</label>
            <input
              id={`${id}-min`}
              inputMode="numeric"
              value={minText ?? (s.min ?? "").toString()}
              onChange={(e) => {
                setMinText(e.target.value);
                onChange({ ...pattern, min: asNumber(e.target.value) });
              }}
              onBlur={() => setMinText(null)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-max`}>Highest number</label>
            <input
              id={`${id}-max`}
              inputMode="numeric"
              value={maxText ?? (s.max ?? "").toString()}
              onChange={(e) => {
                setMaxText(e.target.value);
                onChange({ ...pattern, max: asNumber(e.target.value) });
              }}
              onBlur={() => setMaxText(null)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-pad`}>Pad with zeros to width</label>
            <input
              id={`${id}-pad`}
              inputMode="numeric"
              value={(s.padWidth ?? 0).toString()}
              onChange={(e) =>
                onChange({ ...pattern, pad: Math.max(0, asNumber(e.target.value) ?? 0) })
              }
            />
          </div>
        </div>
      )}

      <p className="field-hint" data-testid={`id-sample-${profile.name}`}>
        Examples (invented): {sample.length > 0 ? sample.join(", ") : "none: the pattern is empty"}
      </p>
      {fit && (
        <p
          className={fit.short ? "banner banner-error" : "field-hint"}
          role={fit.short ? "alert" : undefined}
          data-testid={`id-fit-${profile.name}`}
        >
          {fit.short
            ? shortfallText(fit)
            : `The pattern allows ${fit.allowed.toLocaleString("en-US")} distinct IDs; the column needs ${fit.needed.toLocaleString("en-US")}.`}
        </p>
      )}
    </fieldset>
  );
}
