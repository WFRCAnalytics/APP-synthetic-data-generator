// Type the pattern a date or time column uses, with a live count of how many values it parses
// (FR-005a). A pattern that does not parse every value makes the column unsupported, so the box
// says so before the user applies it.

import { useEffect, useRef, useState } from "react";
import { isSupportedPattern } from "../../lib/datefmt/directives";
import type { DatePatternCheck } from "../../app/session";
import { TextApply } from "./TextApply";

export interface DatePatternBoxProps {
  column: string;
  /** The pattern in effect, if the column is already a date. */
  current: string;
  check: DatePatternCheck | undefined;
  busy: boolean;
  onCheck: (pattern: string) => void;
  onApply: (pattern: string) => void;
}

export const DIRECTIVE_HELP = "%Y year, %m month, %d day, %H hour (24h), %I hour (12h), %M minute, %S second, %p AM/PM, %b Mar, %B March, %j day of year";

export function DatePatternBox({ column, current, check, busy, onCheck, onApply }: DatePatternBoxProps) {
  const [text, setText] = useState(current);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const trimmed = text.trim();
  const supported = trimmed === "" || isSupportedPattern(trimmed);
  const error = supported ? null : "This pattern uses something that is not supported. Use the directives listed below.";

  const typed = (value: string) => {
    setText(value);
    clearTimeout(timer.current);
    const t = value.trim();
    if (t !== "" && isSupportedPattern(t)) timer.current = setTimeout(() => onCheck(t), 350);
  };

  // The count shown belongs to the pattern currently typed, not to an earlier one.
  const live = check && check.pattern === trimmed ? check : undefined;
  const everyValue = live && live.parsed !== null && live.total !== null && live.total > 0 && live.parsed === live.total;
  let status: string | null = null;
  if (live) {
    if (live.parsed === null) status = "Counting…";
    else if (live.total === 0) status = "This pattern parses no values.";
    else if (everyValue) status = `Parses all ${live.total?.toLocaleString("en-US")} values.`;
    else status = `Parses ${live.parsed?.toLocaleString("en-US")} of ${live.total?.toLocaleString("en-US")} values. Applying it would leave this column out of the fake file.`;
  }

  return (
    <div className="date-pattern-box" data-date-pattern-for={column}>
      <TextApply
        label="Date or time pattern"
        value={current}
        placeholder="%m/%d/%Y"
        error={error}
        disabled={busy}
        applyLabel="Use this pattern"
        hint={`Example: %m/%d/%Y or %H:%M. ${DIRECTIVE_HELP}.`}
        onChange={typed}
        onApply={(value) => onApply(value.trim())}
      />
      {status && (
        <p className="field-hint" role="status" data-testid="date-pattern-status">
          {status}
        </p>
      )}
    </div>
  );
}
