// The form of one designed column: its name, its kind-specific limits, and how often it is missing.
// Every field shows its own problem next to it, in words.

import { LOCALES } from "../../lib/textgen/locales";
import { useState } from "react";
import { DATE_FORMATS, DATETIME_FORMATS, KIND_LABELS } from "../../lib/design/defaults";
import type { DesignColumn, DesignProblem } from "../../lib/design/types";
import type { PersonalKind } from "../../lib/spec/types";
import { ChoiceField, FieldShell, NumberField, TextField } from "./fields";
import { DesignIdLink } from "./DesignIdLink";

const PERSONAL_CHOICES: readonly { value: Exclude<PersonalKind, "ssn">; label: string }[] = [
  { value: "full_name", label: "Full names" },
  { value: "first_name", label: "First names" },
  { value: "last_name", label: "Last names" },
  { value: "email", label: "Email addresses" },
  { value: "phone", label: "Phone numbers" },
  { value: "address", label: "Street addresses" },
  { value: "url", label: "Web addresses" },
  { value: "ip", label: "IP addresses" },
];

/** "Bus: 50" per line to labels and weights; a line with no weight counts as 1. */
export function parseLabels(text: string): { label: string; weight: number }[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const at = line.lastIndexOf(":");
      if (at < 0) return { label: line.trim(), weight: 1 };
      const weight = line.slice(at + 1).trim();
      return { label: line.slice(0, at).trim(), weight: weight === "" ? NaN : Number(weight) };
    });
}

export const labelsText = (labels: readonly { label: string; weight: number }[]): string =>
  labels.map((l) => `${l.label}: ${l.weight}`).join("\n");

export interface ColumnFormProps {
  column: DesignColumn;
  problems: readonly DesignProblem[];
  onChange: (column: DesignColumn) => void;
}

export function ColumnForm({ column: c, problems, onChange }: ColumnFormProps) {
  const at = (field: string) => problems.filter((p) => p.field === field);
  const [labelText, setLabelText] = useState(c.kind === "category" ? labelsText(c.labels) : "");

  return (
    <div className="design-form">
      <TextField
        label="Column name"
        value={c.name}
        onChange={(name) => onChange({ ...c, name })}
        problems={at("name")}
        hint="The heading of the column in the file."
      />

      {(c.kind === "integer" || c.kind === "decimal") && (
        <fieldset className="editor-group">
          <legend>{KIND_LABELS[c.kind]} range</legend>
          <div className="design-row">
            <NumberField
              label="Smallest"
              value={c.min}
              onChange={(min) => onChange({ ...c, min })}
              problems={at("min")}
            />
            <NumberField
              label="Largest"
              value={c.max}
              onChange={(max) => onChange({ ...c, max })}
              problems={at("max")}
            />
          </div>
          <ChoiceField
            label="How values are spread"
            value={c.shape}
            options={[
              { value: "even", label: "Evenly across the range" },
              { value: "bell", label: "Around a typical value" },
            ]}
            onChange={(shape) => onChange({ ...c, shape })}
            hint={
              c.shape === "even"
                ? "Every value in the range is as likely as any other."
                : "Most values are near the typical value; fewer are far from it. None leave the range."
            }
          />
          {c.shape === "bell" && (
            <div className="design-row">
              <NumberField
                label="Typical value"
                value={c.typical}
                onChange={(typical) => onChange({ ...c, typical })}
                problems={at("typical")}
              />
              <NumberField
                label="Spread"
                value={c.spread}
                onChange={(spread) => onChange({ ...c, spread })}
                problems={at("spread")}
                hint="About two thirds of values fall within this distance of the typical value."
              />
            </div>
          )}
          {c.kind === "decimal" && (
            <NumberField
              label="Decimal places"
              value={c.decimals}
              onChange={(decimals) => onChange({ ...c, decimals })}
              problems={at("decimals")}
            />
          )}
        </fieldset>
      )}

      {c.kind === "category" && (
        <FieldShell
          label="Labels and how common each is"
          hint="One per line, with a weight after a colon: Bus: 50. A line with no weight counts as 1."
          problems={at("labels")}
        >
          {({ id, describedBy, invalid }) => (
            <textarea
              id={id}
              rows={7}
              value={labelText}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              onChange={(e) => {
                setLabelText(e.target.value);
                onChange({ ...c, labels: parseLabels(e.target.value) });
              }}
            />
          )}
        </FieldShell>
      )}

      {c.kind === "yesno" && (
        <fieldset className="editor-group">
          <legend>The two answers</legend>
          <div className="design-row">
            <TextField
              label="First answer"
              value={c.yesLabel}
              onChange={(yesLabel) => onChange({ ...c, yesLabel })}
              problems={at("labels")}
            />
            <TextField
              label="Second answer"
              value={c.noLabel}
              onChange={(noLabel) => onChange({ ...c, noLabel })}
            />
          </div>
          <NumberField
            label="Share of the first answer (percent)"
            value={c.yesPct}
            onChange={(yesPct) => onChange({ ...c, yesPct })}
            problems={at("yesPct")}
          />
        </fieldset>
      )}

      {(c.kind === "date" || c.kind === "datetime") && (
        <fieldset className="editor-group">
          <legend>{KIND_LABELS[c.kind]} range</legend>
          <div className="design-row">
            <TextField
              label="First day"
              value={c.start}
              onChange={(start) => onChange({ ...c, start })}
              problems={at("start")}
              placeholder="2024-01-31"
              hint="Year-month-day."
            />
            <TextField
              label="Last day"
              value={c.end}
              onChange={(end) => onChange({ ...c, end })}
              problems={at("end")}
              placeholder="2024-12-31"
              hint="Year-month-day."
            />
          </div>
          <ChoiceField
            label="How it is written"
            value={c.format}
            options={c.kind === "date" ? DATE_FORMATS : DATETIME_FORMATS}
            onChange={(format) => onChange({ ...c, format })}
            problems={at("format")}
          />
        </fieldset>
      )}

      {c.kind === "id" && (
        <fieldset className="editor-group">
          <legend>ID pattern</legend>
          <DesignIdLink c={c} onChange={onChange} problems={at} />
          {!c.link && (
            <>
              <div className="design-row">
                <TextField
                  label="Starts with"
                  value={c.prefix}
                  onChange={(prefix) => onChange({ ...c, prefix })}
                  problems={at("prefix")}
                  hint="Optional letters before the digits."
                />
                <NumberField
                  label="Digits"
                  value={c.digits}
                  onChange={(digits) => onChange({ ...c, digits })}
                  problems={at("digits")}
                  hint="Every row gets a different ID."
                />
              </div>
              <p className="field-hint">
                Example: {c.prefix}
                {"0".repeat(
                  Math.max(0, Math.min(15, Number.isFinite(c.digits) ? c.digits - 1 : 0)),
                )}
                1
              </p>
            </>
          )}
        </fieldset>
      )}

      {c.kind === "personal" && (
        <ChoiceField
          label="What to invent"
          value={c.personal}
          options={PERSONAL_CHOICES}
          onChange={(personal) => onChange({ ...c, personal })}
          hint="Invented values, never taken from anyone."
        />
      )}
      {c.kind === "personal" &&
        ["full_name", "first_name", "last_name", "email", "phone", "address"].includes(
          c.personal,
        ) && (
          <ChoiceField
            label="Language and region"
            value={c.locale ?? "en_US"}
            options={LOCALES}
            onChange={(locale) => onChange({ ...c, locale })}
            hint="Where the invented names, emails, phone numbers and addresses come from."
          />
        )}

      {c.kind === "text" && (
        <fieldset className="editor-group">
          <legend>Length in characters</legend>
          <div className="design-row">
            <NumberField
              label="Shortest"
              value={c.minLength}
              onChange={(minLength) => onChange({ ...c, minLength })}
              problems={at("minLength")}
            />
            <NumberField
              label="Longest"
              value={c.maxLength}
              onChange={(maxLength) => onChange({ ...c, maxLength })}
              problems={at("maxLength")}
            />
          </div>
        </fieldset>
      )}

      <NumberField
        label="Missing (percent of rows)"
        value={c.missingPct}
        onChange={(missingPct) => onChange({ ...c, missingPct })}
        problems={at("missingPct")}
        hint="Rows left blank. 0 means every row has a value."
      />
    </div>
  );
}
