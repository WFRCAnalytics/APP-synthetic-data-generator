// Drop-in replacement for a bare <select> — same props, same accessible behavior (id,
// aria-label, value, onChange, disabled all forward straight through to the real <select>
// underneath), just with the native dropdown arrow replaced by a real lucide-react
// ChevronDown icon absolutely positioned over it (theme/app.css strips the native arrow via
// `appearance: none` on every <select> in the app already). `pointer-events: none` on the
// icon means clicks still land on the select beneath it.

import { ChevronDown } from "lucide-react";
import { forwardRef, type SelectHTMLAttributes } from "react";

export const SelectField = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function SelectField(props, ref) {
    return (
      <span className="select-field-wrap">
        <select ref={ref} {...props} />
        <ChevronDown
          className="select-field-arrow"
          size={16}
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </span>
    );
  },
);
