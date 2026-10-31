// The pattern of a short string column (specs/002 FR-007, FR-010, FR-013): the kind of character at each
// position, a live sample of invented values, and a clear message when the pattern cannot hold as many
// distinct values as the column needs (generating is then blocked until it is widened or the column is
// left out). The length of the pattern is fixed: it is the longest value in the column.

import { isLiteral } from "../../lib/mask/mask";
import { patternFit, shortfallText } from "../../lib/profile/idCapacity";
import type { LocalEdits } from "../../lib/profile/edits";
import type { ColumnProfile, MaskToken } from "../../lib/profile/types";
import type { SampleDescription } from "../../lib/textgen/sample";
import { SamplePreview } from "./SamplePreview";

export interface ShortStringEditorProps {
  profile: ColumnProfile;
  samples: string[] | undefined;
  onEdit: (patch: LocalEdits) => void;
  onRequestSamples: ((description: SampleDescription) => void) | undefined;
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

export function ShortStringEditor({ profile, samples, onEdit, onRequestSamples }: ShortStringEditorProps) {
  const s = profile.summary;
  if (s.kind !== "short_string") return null;
  const fit = patternFit(profile);

  const setToken = (i: number, kind: string, literal?: string) => {
    const next = [...s.pattern];
    next[i] = kind === "literal" ? { literal: literal ?? "-" } : (kind as MaskToken);
    onEdit({ shortPattern: next });
  };

  return (
    <fieldset className="id-mask-editor" data-short-pattern-for={profile.name}>
      <legend>String pattern</legend>
      <ol className="id-mask-positions">
        {s.pattern.map((t, i) => (
          <li key={i}>
            <select aria-label={`Position ${i + 1}`} value={kindOf(t)} onChange={(e) => setToken(i, e.target.value)}>
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
                  if (e.target.value !== "") setToken(i, "literal", Array.from(e.target.value).slice(-1)[0]);
                }}
              />
            )}
          </li>
        ))}
      </ol>
      <div className="actions-row">
        <button type="button" className="button-link" onClick={() => onEdit({ shortPattern: undefined })}>
          Reset to detected
        </button>
      </div>
      <p className="field-hint">Values keep the real lengths ({Object.keys(s.lengthGroups).length} different) and the real number of distinct values ({s.distinct.toLocaleString("en-US")}). They are invented; none comes from your data.</p>
      <SamplePreview column={profile.name} description={{ kind: "short_string", pattern: s.pattern, lengthGroups: s.lengthGroups }} samples={samples} onRequest={onRequestSamples} />
      {fit?.short && (
        <p className="banner banner-error" role="alert" data-testid={`short-fit-${profile.name}`}>
          {shortfallText(fit)}
        </p>
      )}
    </fieldset>
  );
}
