// Rules between columns on Review (specs/015): relations the person states, such as "end date comes 0 to 30 days after start date".
// A rule changes one column (the target) using another (the source) in the same row. The list shows what is stated; a rule that does
// not fit the table is refused with the reason.

import { Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { InfoTip } from "../../components/InfoTip";
import type { ColumnProfile } from "../../lib/profile/types";
import { describeRule, RULE_KINDS, type RuleSpec } from "../../lib/rules/types";

export interface RulesPanelProps {
  profiles: readonly ColumnProfile[];
  rules: readonly RuleSpec[];
  onAdd: (rule: RuleSpec) => string | null;
  onRemove: (index: number) => void;
}

const isDateLike = (p: ColumnProfile) =>
  p.type === "date" || p.type === "datetime" || p.type === "time";
const isNumber = (p: ColumnProfile) => p.type === "integer" || p.type === "float";
const isLabelled = (p: ColumnProfile) =>
  (p.type === "categorical" || p.type === "boolean") && p.summary.kind === "categorical";
const labelsOf = (p: ColumnProfile | undefined): string[] =>
  p && p.summary.kind === "categorical" ? Object.keys(p.summary.counts) : [];

export function RulesPanel({ profiles, rules, onAdd, onRemove }: RulesPanelProps) {
  const id = useId();
  const usable = profiles.filter((p) => p.type !== "unsupported" && p.exclude !== "drop");
  const [kind, setKind] = useState<RuleSpec["kind"]>("follows");
  const [column, setColumn] = useState("");
  const [other, setOther] = useState("");
  const [min, setMin] = useState("0");
  const [max, setMax] = useState("30");
  const [whenValue, setWhenValue] = useState("");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const targets =
    kind === "follows"
      ? usable.filter((p) => isDateLike(p) || isNumber(p))
      : kind === "set_when"
        ? usable.filter(isLabelled)
        : usable;
  const sources =
    kind === "follows"
      ? usable.filter(
          (p) =>
            (isDateLike(p) && isDateLike(profiles.find((q) => q.name === column) ?? p)) ||
            (isNumber(p) && isNumber(profiles.find((q) => q.name === column) ?? p)),
        )
      : kind === "set_when"
        ? usable.filter(isLabelled)
        : usable;
  const sourceProfile = profiles.find((p) => p.name === other);
  const targetProfile = profiles.find((p) => p.name === column);

  const submit = () => {
    setMessage(null);
    if (column === "" || other === "") return setMessage("Choose the two columns.");
    let rule: RuleSpec;
    if (kind === "follows") {
      const lo = Number(min);
      const hi = Number(max);
      if (!Number.isInteger(lo) || !Number.isInteger(hi))
        return setMessage("The gap must be whole numbers.");
      rule = { kind, column, after: other, min: lo, max: hi };
    } else if (kind === "blank_with") rule = { kind, column, with: other };
    else {
      if (whenValue === "" || value === "") return setMessage("Choose both values.");
      rule = { kind, column, when_column: other, when_value: whenValue, value };
    }
    const problem = onAdd(rule);
    if (problem) return setMessage(problem);
    setColumn("");
    setOther("");
    setWhenValue("");
    setValue("");
  };

  return (
    <div className="rules-panel">
      <h4 className="overview-subhead">
        Rules between columns{" "}
        <InfoTip label="More information">
          Relations you state, such as an end date that comes after a start date. They hold in every
          row and are checked on Generate. A column a rule changes keeps no summary of its own.
        </InfoTip>
      </h4>

      {rules.length > 0 && (
        <ul className="rule-list" aria-label="Rules">
          {rules.map((r, i) => (
            <li key={`${r.kind}-${r.column}-${i}`}>
              <span>{describeRule(r)}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove the rule: ${describeRule(r)}`}
                title="Remove this rule"
                onClick={() => onRemove(i)}
              >
                <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <details className="rule-form">
        <summary>Add a rule</summary>
        <div className="field">
          <label htmlFor={`${id}-kind`}>Kind of rule</label>
          <select
            id={`${id}-kind`}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as RuleSpec["kind"]);
              setColumn("");
              setOther("");
              setWhenValue("");
              setValue("");
            }}
          >
            {RULE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-column`}>Column that changes</label>
          <select
            id={`${id}-column`}
            value={column}
            onChange={(e) => {
              setColumn(e.target.value);
              setOther("");
              setValue("");
            }}
          >
            <option value="">Choose a column</option>
            {targets.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-other`}>
            {kind === "follows"
              ? "Comes after"
              : kind === "blank_with"
                ? "Is blank when this is blank"
                : "When this column"}
          </label>
          <select
            id={`${id}-other`}
            value={other}
            onChange={(e) => {
              setOther(e.target.value);
              setWhenValue("");
            }}
          >
            <option value="">Choose a column</option>
            {sources
              .filter((p) => p.name !== column)
              .map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>
        {kind === "follows" && (
          <div className="inline-row">
            <div className="field inline-field">
              <label htmlFor={`${id}-min`}>Gap from</label>
              <input
                id={`${id}-min`}
                className="inline-input--number"
                inputMode="numeric"
                value={min}
                onChange={(e) => setMin(e.target.value)}
              />
            </div>
            <div className="field inline-field">
              <label htmlFor={`${id}-max`}>to</label>
              <input
                id={`${id}-max`}
                className="inline-input--number"
                inputMode="numeric"
                value={max}
                onChange={(e) => setMax(e.target.value)}
              />
              <InfoTip label="More information">
                In days for a date column and in seconds for a date and time or a time. For a number
                column, in the units of the column.
              </InfoTip>
            </div>
          </div>
        )}
        {kind === "set_when" && (
          <div className="inline-row">
            <div className="field inline-field">
              <label htmlFor={`${id}-when`}>Is</label>
              <select
                id={`${id}-when`}
                value={whenValue}
                onChange={(e) => setWhenValue(e.target.value)}
              >
                <option value="">Choose a value</option>
                {labelsOf(sourceProfile).map((l) => (
                  <option key={l} value={l}>
                    {l === "" ? "(blank)" : l}
                  </option>
                ))}
              </select>
            </div>
            <div className="field inline-field">
              <label htmlFor={`${id}-value`}>Then the column is</label>
              <select id={`${id}-value`} value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">Choose a value</option>
                {labelsOf(targetProfile).map((l) => (
                  <option key={l} value={l}>
                    {l === "" ? "(blank)" : l}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        {message && (
          <span className="field-hint field-error" role="alert">
            {message}
          </span>
        )}
        <div className="actions-row">
          <button type="button" className="button button-secondary" onClick={submit}>
            Add the rule
          </button>
        </div>
      </details>
    </div>
  );
}
