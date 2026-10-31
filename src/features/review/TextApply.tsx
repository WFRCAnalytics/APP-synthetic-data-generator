// A labelled text box with an Apply button (Enter also applies), used by the editors that take a
// typed value: sentinel codes, NA tokens, a date pattern, a new column name.

import { useEffect, useId, useState } from "react";

export interface TextApplyProps {
  label: string;
  /** The value currently in effect; the box resets to it when it changes. */
  value: string;
  onApply: (text: string) => void;
  hint?: string;
  /** A problem with the typed text; blocks Apply. */
  error?: string | null;
  disabled?: boolean;
  applyLabel?: string;
  placeholder?: string;
  /** Called as the user types (for a live check). */
  onChange?: (text: string) => void;
  /** An extra button, such as "Use the proposed codes". */
  extra?: { label: string; onClick: () => void };
}

export function TextApply({ label, value, onApply, hint, error, disabled, applyLabel = "Apply", placeholder, onChange, extra }: TextApplyProps) {
  const id = useId();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);

  const submit = () => {
    if (!disabled && !error) onApply(text);
  };

  return (
    <form
      className="field text-apply"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className="text-apply-row">
        <input
          id={id}
          type="text"
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint`}
          onChange={(e) => {
            setText(e.target.value);
            onChange?.(e.target.value);
          }}
        />
        <button type="submit" className="button button-secondary" disabled={disabled || Boolean(error) || text === value}>
          {applyLabel}
        </button>
        {extra && (
          <button type="button" className="button-link" onClick={extra.onClick} disabled={disabled}>
            {extra.label}
          </button>
        )}
      </div>
      {error ? (
        <span id={`${id}-hint`} className="field-hint field-error" role="alert">
          {error}
        </span>
      ) : (
        hint && (
          <span id={`${id}-hint`} className="field-hint">
            {hint}
          </span>
        )
      )}
    </form>
  );
}
