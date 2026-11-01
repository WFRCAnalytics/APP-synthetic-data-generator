// Labelled inputs for the Design screen. A number is typed as text and parsed on every change, so a
// half-typed value ("1.", "-") is never fought with, and a blank or bad one reaches validation as NaN
// instead of silently becoming 0.

import { useEffect, useId, useState, type ReactNode } from "react";
import { SelectField } from "../../components/SelectField";
import type { DesignProblem } from "../../lib/design/types";

export interface FieldShellProps {
  label: string;
  hint?: string;
  /** Messages for this field, from validateDesign. */
  problems?: readonly DesignProblem[];
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

export function FieldShell({ label, hint, problems = [], children }: FieldShellProps) {
  const id = useId();
  const messages = problems.map((p) => p.message);
  const describedBy = messages.length > 0 ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, describedBy, invalid: messages.length > 0 })}
      {messages.length > 0 ? (
        <span id={`${id}-error`} className="field-hint field-error">
          {messages.join(" ")}
        </span>
      ) : (
        hint && (
          <span id={`${id}-hint`} className="field-hint">
            {hint}
          </span>
        )
      )}
    </div>
  );
}

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
  problems?: readonly DesignProblem[];
  disabled?: boolean;
}

export function NumberField({ label, value, onChange, hint, problems, disabled }: NumberFieldProps) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : "");
  // A value changed from outside (another column picked, a default restored) replaces what was typed.
  useEffect(() => {
    setText((current) => (Number(current) === value && current.trim() !== "" ? current : Number.isFinite(value) ? String(value) : current));
  }, [value]);
  return (
    <FieldShell label={label} hint={hint} problems={problems}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value.trim() === "" ? NaN : Number(e.target.value));
          }}
        />
      )}
    </FieldShell>
  );
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  problems?: readonly DesignProblem[];
  placeholder?: string;
}

export function TextField({ label, value, onChange, hint, problems, placeholder }: TextFieldProps) {
  return (
    <FieldShell label={label} hint={hint} problems={problems}>
      {({ id, describedBy, invalid }) => <input id={id} type="text" value={value} placeholder={placeholder} aria-invalid={invalid || undefined} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} />}
    </FieldShell>
  );
}

export interface ChoiceFieldProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  hint?: string;
  problems?: readonly DesignProblem[];
}

export function ChoiceField<T extends string>({ label, value, options, onChange, hint, problems }: ChoiceFieldProps<T>) {
  return (
    <FieldShell label={label} hint={hint} problems={problems}>
      {({ id, describedBy, invalid }) => (
        <SelectField id={id} value={value} aria-invalid={invalid || undefined} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
      )}
    </FieldShell>
  );
}
