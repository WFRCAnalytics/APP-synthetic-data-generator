// Putting rules into the plan (specs/015). Each rule wraps the target column's generator: the value of the target in a row is
// computed from the value the source generator gives for the same row. Generators depend only on (seed, column, row), so a
// source can be asked for any row and the output does not depend on chunk size or on the order of columns.

import { formatDate, fromNumber, parseDate, patternKind, toNumber } from "../datefmt/directives";
import { drawUniform } from "../rng/counter";
import { subSeed } from "../rng/subseed";
import type { ColumnSpec, SpecFile } from "../spec/types";
import { createColumnGen, naTokenOf, type ColumnContext, type ColumnGen } from "../generate/column";
import type { FollowsRule, RuleSpec } from "./types";

const GAP_STREAM = 77;

/** Whether a cell text is a blank of the column (an NA token, or the empty field). */
export const isBlank = (col: ColumnSpec, text: string): boolean =>
  (col.na?.tokens ?? [""]).includes(text) || (col.na === undefined && text === "");

const sentinelKeys = (col: ColumnSpec): Set<string> => new Set(Object.keys(col.sentinels ?? {}));

/** The gap of a row, a whole number from min to max, the same every time for the same seed, column and row. */
export function gapAt(key: number, row: number, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(drawUniform(key, row, GAP_STREAM) * (max - min + 1));
}

function followsGen(
  target: ColumnSpec,
  source: ColumnSpec,
  sourceGen: ColumnGen,
  rule: FollowsRule,
  base: ColumnGen,
  key: number,
): ColumnGen {
  const blank = naTokenOf(target);
  const sentinels = sentinelKeys(source);
  const dateLike = (c: ColumnSpec): c is Extract<ColumnSpec, { format: string }> =>
    c.type === "date" || c.type === "datetime" || c.type === "time";

  if (dateLike(target) && dateLike(source)) {
    const sourceKind = patternKind(source.format);
    const targetKind = patternKind(target.format);
    return {
      ...base,
      valueAt: (row) => {
        const text = sourceGen.valueAt(row);
        if (isBlank(source, text) || sentinels.has(text)) return blank;
        const parsed = parseDate(text, source.format);
        if (!parsed) return blank;
        const from = toNumber(parsed, sourceKind);
        const startSeconds = sourceKind === "date" ? from * 86400 : from;
        // The gap is in days for a date column and in seconds for a moment or a time.
        const seconds =
          startSeconds + gapAt(key, row, rule.min, rule.max) * (target.type === "date" ? 86400 : 1);
        const value =
          targetKind === "date"
            ? Math.floor(seconds / 86400)
            : targetKind === "time"
              ? ((seconds % 86400) + 86400) % 86400
              : seconds;
        return formatDate(fromNumber(value, targetKind), target.format);
      },
    };
  }

  const decimals = target.type === "float" ? (target.decimals ?? 0) : 0;
  const thousands = target.type === "integer" || target.type === "float" ? target.thousands : false;
  return {
    ...base,
    valueAt: (row) => {
      const text = sourceGen.valueAt(row);
      if (isBlank(source, text) || sentinels.has(text)) return blank;
      const n = Number(text.replace(/,/g, ""));
      if (!Number.isFinite(n)) return blank;
      const out = (n + gapAt(key, row, rule.min, rule.max)).toFixed(decimals);
      return thousands
        ? Number(out).toLocaleString("en-US", {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          })
        : out;
    },
  };
}

/**
 * The plan's columns with the rules applied. A source that is not in the plan (left out of the file) is made on the side, so a rule
 * still sees its values. `columns` are in plan order; the result is in the same order.
 */
export function applyRules(spec: SpecFile, columns: ColumnGen[], ctx: ColumnContext): ColumnGen[] {
  const rules: readonly RuleSpec[] = spec.rules ?? [];
  if (rules.length === 0) return columns;

  const byName = new Map(columns.map((c) => [c.name, c]));
  const sideGen = (name: string): ColumnGen | undefined => {
    const hit = byName.get(name);
    if (hit) return hit;
    const col = spec.columns.find((c) => c.name === name);
    return col ? createColumnGen(col, ctx) : undefined;
  };

  const replaced = new Map<string, ColumnGen>();
  for (const rule of rules) {
    const target = byName.get(rule.column);
    if (!target) continue; // a target left out of the file needs no rule
    const targetSpec = target.spec;
    const sourceName =
      rule.kind === "follows"
        ? rule.after
        : rule.kind === "blank_with"
          ? rule.with
          : rule.when_column;
    const sourceGen = sideGen(sourceName);
    const sourceSpec = sourceGen?.spec;
    if (!sourceGen || !sourceSpec) continue;

    switch (rule.kind) {
      case "follows":
        replaced.set(
          rule.column,
          followsGen(
            targetSpec,
            sourceSpec,
            sourceGen,
            rule,
            target,
            subSeed(ctx.seed, `${rule.column}\u0000follows`),
          ),
        );
        break;
      case "blank_with": {
        const blank = naTokenOf(targetSpec);
        replaced.set(rule.column, {
          ...target,
          valueAt: (row) =>
            isBlank(sourceSpec, sourceGen.valueAt(row)) ? blank : target.valueAt(row),
        });
        break;
      }
      case "set_when":
        replaced.set(rule.column, {
          ...target,
          valueAt: (row) =>
            sourceGen.valueAt(row) === rule.when_value ? rule.value : target.valueAt(row),
        });
        break;
    }
  }
  return columns.map((c) => replaced.get(c.name) ?? c);
}
