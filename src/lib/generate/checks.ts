// The check table (FR-026, constitution Principle V): after generating, measure the output and
// compare every summary with its target from the spec. Measurements come from the written text,
// parsed back, so the check is independent of how values were produced.

import { parseDate, patternKind, toNumber as dateToNumber } from "../datefmt/directives";
import { effectiveCounts } from "../protections";
import { fitBeta } from "../sampling";
import type { CategoricalColumn, ColumnSpec, DateColumn, NumericColumn } from "../spec/types";
import type { TablePlan } from "./table";

export interface CheckRow {
  column: string;
  metric: "label_counts" | "na_count" | "sentinel_counts" | "min" | "max" | "mean" | "sd" | "repeat_structure";
  target: string;
  achieved: string;
  /** Exact metrics must be equal; mean and sd are fitted targets and pass within a tolerance. */
  pass: boolean;
}

const isCategorical = (c: ColumnSpec): c is CategoricalColumn => c.type === "categorical" || c.type === "boolean";
const isNumericLike = (c: ColumnSpec): c is NumericColumn | DateColumn =>
  c.type === "integer" || c.type === "float" || c.type === "date" || c.type === "datetime" || c.type === "time";

interface Acc {
  col: ColumnSpec;
  naTokens: Set<string>;
  sentinelKeys: Set<string>;
  naByToken: Map<string, number>;
  sentinelByKey: Map<string, number>;
  labels: Map<string, number>;
  n: number;
  min: number;
  max: number;
  mean: number;
  m2: number;
  parse: ((text: string) => number | null) | null;
}

const numberParser = (thousands: boolean) => (text: string) => {
  const n = Number(thousands ? text.replace(/,/g, "") : text);
  return Number.isFinite(n) ? n : null;
};

function makeAcc(col: ColumnSpec): Acc {
  let parse: Acc["parse"] = null;
  if (col.type === "integer" || col.type === "float") parse = numberParser(col.thousands ?? false);
  if (col.type === "date" || col.type === "datetime" || col.type === "time") {
    const kind = patternKind(col.format);
    parse = (text) => {
      const d = parseDate(text, col.format);
      return d ? dateToNumber(d, kind) : null;
    };
  }
  return {
    col,
    naTokens: new Set(col.na?.tokens ?? []),
    sentinelKeys: new Set(Object.keys(col.sentinels ?? {})),
    naByToken: new Map(),
    sentinelByKey: new Map(),
    labels: new Map(),
    n: 0,
    min: Infinity,
    max: -Infinity,
    mean: 0,
    m2: 0,
    parse,
  };
}

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

const show = (m: Record<string, number>): string => {
  const text = JSON.stringify(m);
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
};
const sameCounts = (a: Record<string, number>, b: Record<string, number>): boolean => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};
const toObject = (m: Map<string, number>): Record<string, number> => Object.fromEntries([...m.entries()].sort((x, y) => x[0].localeCompare(y[0])));
const sortedObject = (o: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(o).filter(([, n]) => n > 0).sort((x, y) => x[0].localeCompare(y[0])));
// A mean is judged against the column's spread (a sample mean wanders by sd / sqrt(n)), so a mean
// near zero is not held to 5% of itself. An sd is a fitted target, not an exact one.
const meanClose = (achieved: number, target: number, sd: number): boolean =>
  Math.abs(achieved - target) <= Math.max(1e-9, Math.abs(target) * 0.05, sd * 0.1);
const sdClose = (achieved: number, target: number): boolean => Math.abs(achieved - target) <= Math.max(1e-9, target * 0.15);

/** Measures the generated rows one at a time and reports target versus achieved per column. */
export class CheckAccumulator {
  private readonly accs: Acc[];

  constructor(plan: TablePlan) {
    // Columns written as all-NA (kept as all-NA, or empty) have nothing to measure but NA counts.
    this.accs = plan.columns.map((c) => makeAcc(c.spec));
  }

  observeRow(values: readonly string[]): void {
    for (let c = 0; c < this.accs.length; c++) {
      const a = this.accs[c];
      const text = values[c];
      if (a.naTokens.has(text)) {
        bump(a.naByToken, text);
        continue;
      }
      if (a.sentinelKeys.has(text)) {
        bump(a.sentinelByKey, text);
        continue;
      }
      if (isCategorical(a.col) || a.col.type === "survey_id") {
        bump(a.labels, text); // for an ID column this tallies how often each (invented) ID appears
      } else if (a.parse) {
        const x = a.parse(text);
        if (x === null) continue;
        a.n++;
        if (x < a.min) a.min = x;
        if (x > a.max) a.max = x;
        const delta = x - a.mean;
        a.mean += delta / a.n;
        a.m2 += delta * (x - a.mean);
      }
    }
  }

  finish(): CheckRow[] {
    const rows: CheckRow[] = [];
    for (const a of this.accs) {
      const col = a.col;
      if (col.type === "unsupported") continue; // written as all-NA; nothing to compare
      const add = (metric: CheckRow["metric"], target: string, achieved: string, pass: boolean) =>
        rows.push({ column: col.name, metric, target, achieved, pass });

      // NA counts, per token.
      const naTarget = col.na?.by_token ? { ...col.na.by_token } : col.na ? { [col.na.tokens[0] ?? ""]: col.na.count } : {};
      const naAchieved = toObject(a.naByToken);
      if (col.type === "empty") {
        add("na_count", show(sortedObject(naTarget)), show(naAchieved), sameCounts(sortedObject(naTarget), naAchieved));
        continue;
      }
      if (col.na || a.naByToken.size > 0) {
        add("na_count", show(sortedObject(naTarget)), show(naAchieved), sameCounts(sortedObject(naTarget), naAchieved));
      }

      if (col.sentinels && Object.keys(col.sentinels).length > 0) {
        const got = toObject(a.sentinelByKey);
        add("sentinel_counts", show(sortedObject(col.sentinels)), show(got), sameCounts(sortedObject(col.sentinels), got));
      }

      if (isCategorical(col)) {
        const want = sortedObject(effectiveCounts(col.counts, col));
        const got = toObject(a.labels);
        add("label_counts", show(want), show(got), sameCounts(want, got));
      } else if (col.type === "survey_id") {
        // How many IDs appear once, twice, three times: the repeat structure must be reproduced exactly.
        const sizes: Record<string, number> = {};
        for (const n of a.labels.values()) sizes[n] = (sizes[n] ?? 0) + 1;
        const want = sortedObject(col.repeat_structure);
        add("repeat_structure", show(want), show(sortedObject(sizes)), sameCounts(want, sortedObject(sizes)));
      } else if (isNumericLike(col)) {
        add("min", String(col.min), a.n > 0 ? String(a.min) : "n/a", a.n > 0 && a.min === col.min);
        add("max", String(col.max), a.n > 0 ? String(a.max) : "n/a", a.n > 0 && a.max === col.max);
        // Mean and sd are only targets when the column uses a fitted beta (match_mean_sd).
        if (col.mode === "match_mean_sd" && col.mean !== undefined && col.sd !== undefined && fitBeta(col.mean, col.sd, col.min, col.max)) {
          const mean = a.mean;
          const sd = a.n > 0 ? Math.sqrt(a.m2 / a.n) : 0;
          add("mean", String(col.mean), String(mean), meanClose(mean, col.mean, col.sd));
          add("sd", String(col.sd), String(sd), sdClose(sd, col.sd));
        }
      }
    }
    return rows;
  }
}
