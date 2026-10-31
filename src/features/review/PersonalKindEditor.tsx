// The kind of a personal identifier column (specs/002 FR-001, FR-010): what the app proposed, a way to
// change it, a plain-language explanation, a live sample of invented values and, for social-security
// style numbers, the acknowledgement that switches generating on. Nothing here shows a real value.

import { useId } from "react";
import type { LocalEdits } from "../../lib/profile/edits";
import type { ColumnProfile, PersonalKind } from "../../lib/profile/types";
import type { SampleDescription } from "../../lib/textgen/sample";
import { needsSuffix } from "../../lib/textgen/space";
import { SamplePreview } from "./SamplePreview";
import { PERSONAL_LABELS } from "./summary";

export interface PersonalKindEditorProps {
  profile: ColumnProfile;
  samples: string[] | undefined;
  onEdit: (patch: LocalEdits) => void;
  onRequestSamples: ((description: SampleDescription) => void) | undefined;
}

const KINDS: PersonalKind[] = ["full_name", "first_name", "last_name", "email", "phone", "address", "url", "ip", "ssn"];

const KIND_LABEL: Record<PersonalKind, string> = {
  full_name: "Full name",
  first_name: "First name",
  last_name: "Last name",
  email: "Email address",
  phone: "US phone number",
  address: "Street address",
  url: "Web address",
  ip: "IP address",
  ssn: "Social-security-style number",
};

const NAME_KINDS: PersonalKind[] = ["full_name", "first_name", "last_name"];

export function PersonalKindEditor({ profile, samples, onEdit, onRequestSamples }: PersonalKindEditorProps) {
  const id = useId();
  const s = profile.summary;
  if (s.kind !== "personal") return null;

  const kind = s.personalKind;
  const acknowledged = profile.acknowledged === true;
  const showSample = kind !== "ssn" || acknowledged;
  const shapes = s.format?.shapes ?? [];

  return (
    <fieldset className="personal-editor" data-personal-for={profile.name}>
      <legend>Kind of personal data</legend>

      <div className="field">
        <label htmlFor={`${id}-kind`}>Kind</label>
        <select id={`${id}-kind`} value={kind} onChange={(e) => onEdit({ personalKind: e.target.value as PersonalKind })}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      <p className="field-hint">
        The fake column holds invented {PERSONAL_LABELS[kind]}, not values from your data. It keeps the same number of distinct values ({s.distinct.toLocaleString("en-US")}), the same number of repeats and the same missing values. No real value is stored in the spec.
      </p>

      {kind === "phone" && shapes.length > 1 && (
        <p className="field-hint" data-testid={`phone-formats-${profile.name}`}>
          This column mixes phone formats: {shapes.map((f) => `${f.shape} (${Math.round(f.share * 100)}%)`).join(", ")}. The fake column keeps the same mix.
        </p>
      )}

      {(NAME_KINDS.includes(kind) || kind === "address") && (
        <p className="field-hint">Invented values use plain US English characters, so accents or other scripts in the real values are not kept.</p>
      )}

      {needsSuffix(kind, s.distinct) && (
        <p className="field-hint" data-testid={`suffix-note-${profile.name}`}>
          This column needs more distinct values than can be invented naturally, so a short number is added to some of them to keep every value different.
        </p>
      )}

      {kind === "ssn" && (
        <div className="field">
          <label htmlFor={`${id}-ack`}>
            <input id={`${id}-ack`} type="checkbox" checked={acknowledged} onChange={(e) => onEdit({ ssnAcknowledged: e.target.checked })} /> I understand that invented social-security-style numbers will be generated
          </label>
          <span className="field-hint">They use area numbers 900 to 999, which are never assigned to a real person. Until you accept, this column is left out of the fake file.</span>
        </div>
      )}

      <SamplePreview
        column={profile.name}
        description={showSample ? { kind: "personal", personalKind: kind, format: s.format } : null}
        samples={samples}
        onRequest={onRequestSamples}
      />
    </fieldset>
  );
}
