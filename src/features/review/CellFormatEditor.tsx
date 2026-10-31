// The number format a column has in the fake workbook (specs/003 FR-006). It starts as the format of the
// real column's cells; this lets the user pick another one that suits the column's type, or type a code.
// Only the code is shown, never a cell.

import { useId, useState } from "react";
import type { ColumnProfile, ColumnType } from "../../lib/profile/types";
import { cellFormatProblem } from "./cellFormatProblem";
import { TextApply } from "./TextApply";

export interface CellFormatEditorProps {
  profile: ColumnProfile;
  onChange: (code: string) => void;
}

const GENERAL = "General";

/** The formats offered for each kind of column. */
function presets(type: ColumnType): [string, string][] {
  switch (type) {
    case "integer":
      return [[GENERAL, "General"], ["0", "0"], ["#,##0", "1,234"], ["0%", "12%"]];
    case "float":
      return [[GENERAL, "General"], ["0.00", "0.00"], ["#,##0.00", "1,234.50"], ["0.00%", "12.34%"], ["$#,##0.00", "$1,234.50"], ["0.00E+00", "1.23E+03"]];
    case "date":
      return [["mm/dd/yyyy", "01/31/2024"], ["yyyy-mm-dd", "2024-01-31"], ["m/d/yy", "1/31/24"], ["d-mmm-yy", "31-Jan-24"]];
    case "datetime":
      return [["yyyy-mm-dd hh:mm:ss", "2024-01-31 08:30:00"], ["m/d/yyyy h:mm", "1/31/2024 8:30"]];
    case "time":
      return [["hh:mm:ss", "08:30:00"], ["h:mm AM/PM", "8:30 AM"]];
    default:
      return [[GENERAL, "General"], ["@", "Text (@)"]];
  }
}

const CUSTOM = "\u0000custom";

export function CellFormatEditor({ profile, onChange }: CellFormatEditorProps) {
  const id = useId();
  const current = profile.cellFormat ?? (profile.type === "date" || profile.type === "datetime" || profile.type === "time" ? "" : GENERAL);
  const options = presets(profile.type);
  const known = options.some(([code]) => code === current);
  const [custom, setCustom] = useState(false);
  const [typed, setTyped] = useState(current);
  const showCustom = custom || (!known && current !== "");
  const error = showCustom ? cellFormatProblem(profile, typed) : null;

  return (
    <div className="field" data-testid="cell-format-editor">
      <label htmlFor={id}>Format in the Excel file</label>
      <select
        id={id}
        value={showCustom ? CUSTOM : current}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true);
            return;
          }
          setCustom(false);
          onChange(e.target.value);
        }}
      >
        {current === "" && <option value="">Choose a format</option>}
        {options.map(([code, example]) => (
          <option key={code} value={code}>
            {code === example ? code : `${code} (${example})`}
          </option>
        ))}
        <option value={CUSTOM}>{!known && current !== "" && !custom ? `Custom: ${current}` : "Custom code…"}</option>
      </select>
      {showCustom && (
        <TextApply
          label="Custom format code"
          value={current}
          placeholder="#,##0.00"
          error={error}
          applyLabel="Use this format"
          hint="A number format as Excel writes it, such as 0.0 or yyyy-mm-dd."
          onChange={setTyped}
          onApply={(text) => onChange(text.trim())}
        />
      )}
      <span className="field-hint">How the cells look in Excel. The values are made up either way.</span>
    </div>
  );
}
