// The check table (FR-026, constitution Principle V): after generating, measure the output and
// compare every summary with its target from the spec. Measurements come from the written text,
// parsed back, so the check is independent of how values were produced.

import { parseDate, patternKind, toNumber as dateToNumber } from "../datefmt/directives";
import { effectiveCounts } from "../protections";
import { fitBeta } from "../sampling";
import type {
  CategoricalColumn,
  ColumnSpec,
  DateColumn,
  FreeTextColumn,
  NumericColumn,
} from "../spec/types";
import { DistinctCounter } from "./distinct";
import { describeRule, type RuleSpec } from "../rules/types";
import { isBlank } from "../rules/apply";
import type { TablePlan } from "./table";

export interface CheckRow {
  column: string;
  metric:
    | "rule"
    | "children"
    | "parent_values"
    | "label_counts"
    | "na_count"
    | "sentinel_counts"
    | "min"
    | "max"
    | "mean"
    | "sd"
    | "repeat_structure"
    | "distinct_count"
    | "length_min"
    | "length_max"
    | "narrowed"
    | "unparsed";
  target: string;
  achieved: string;
  /** Exact metrics must be equal; mean and sd are fitted targets and pass within a tolerance. */
  pass: boolean;
}

const isCategorical = (c: ColumnSpec): c is CategoricalColumn =>
  c.type === "categorical" || c.type === "boolean";
const isNumericLike = (c: ColumnSpec): c is NumericColumn | DateColumn | FreeTextColumn =>
  c.type === "integer" ||
  c.type === "float" ||
  c.type === "date" ||
  c.type === "datetime" ||
  c.type === "time" ||
  c.type === "free_text";

interface Acc {
  col: ColumnSpec;
  naTokens: Set<string>;
  sentinelKeys: Set<string>;
  naByToken: Map<string, number>;
  sentinelByKey: Map<string, number>;
  labels: Map<string, number>;
  /** Repeat structure and distinct count of invented values, kept as hashes (see distinct.ts). */
  distinct: DistinctCounter | null;
  /** Shortest and longest value written, for text columns. */
  lenMin: number;
  lenMax: number;
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

const hasDistinct = (col: ColumnSpec): boolean =>
  col.type === "survey_id" || col.type === "personal" || col.type === "short_string";

function makeAcc(col: ColumnSpec): Acc {
  let parse: Acc["parse"] = null;
  if (col.type === "integer" || col.type === "float") parse = numberParser(col.thousands ?? false);
  if (col.type === "free_text") parse = (text) => text.length;
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
    distinct: hasDistinct(col) ? new DistinctCounter() : null,
    lenMin: Infinity,
    lenMax: 0,
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
const toObject = (m: Map<string, number>): Record<string, number> =>
  Object.fromEntries([...m.entries()].sort((x, y) => x[0].localeCompare(y[0])));
const sortedObject = (o: Record<string, number>): Record<string, number> =>
  Object.fromEntries(
    Object.entries(o)
      .filter(([, n]) => n > 0)
      .sort((x, y) => x[0].localeCompare(y[0])),
  );
// A mean is judged against the column's spread (a sample mean wanders by sd / sqrt(n)), so a mean
// near zero is not held to 5% of itself. An sd is a fitted target, not an exact one.
const meanClose = (achieved: number, target: number, sd: number): boolean =>
  Math.abs(achieved - target) <= Math.max(1e-9, Math.abs(target) * 0.05, sd * 0.1);
const sdClose = (achieved: number, target: number): boolean =>
  Math.abs(achieved - target) <= Math.max(1e-9, target * 0.15);

/** Measures the generated rows one at a time and reports target versus achieved per column. */
export class CheckAccumulator {
  private readonly accs: Acc[];
  private readonly rules: RuleCheck[];
  /** Columns a rule changes: their own summaries no longer hold, so the rule is what is checked. */
  private readonly derived: Set<number>;

  constructor(plan: TablePlan) {
    // Columns written as all-NA (kept as all-NA, or empty) have nothing to measure but NA counts.
    this.accs = plan.columns.map((c) => makeAcc(c.spec));
    const index = new Map(plan.columns.map((c, i) => [c.name, i]));
    this.rules = plan.rules.map((r) => makeRuleCheck(r, plan, index));
    this.derived = new Set(
      plan.rules.map((r) => index.get(r.column)).filter((i): i is number => i !== undefined),
    );
    // A column that counts another table's rows is checked by what the counts add up to, not by its own summaries.
    plan.columns.forEach((c, i) => {
      const fp = c.spec.type === "categorical" || c.spec.type === "boolean" ? c.spec.from_parent : undefined;
      if (fp) {
        this.derived.add(i);
        let leaf = fp.parent; // through a chain of tables the values are those of the last one
        while (leaf.from_parent) leaf = leaf.from_parent.parent;
        const allowed = new Set([...Object.keys(leaf.counts), ...(leaf.na?.tokens ?? []), ...Object.keys(leaf.sentinels ?? {})]);
        this.followers.push({ column: c.outputName, index: i, allowed, table: fp.parent.table, outside: 0 });
      }
      const cc = c.spec.type === "integer" ? c.spec.child_count : undefined;
      if (!cc) return;
      this.derived.add(i);
      this.counts.push({ column: c.outputName, index: i, expected: Object.entries(cc.child.repeat_structure).reduce((n, [size, groups]) => n + Number(size) * groups, 0), table: cc.child.table, total: 0 });
    });
  }

  /** Columns that take another table's value: the values they may hold, and how many rows hold something else. */
  private readonly followers: { column: string; index: number; allowed: Set<string>; table?: string; outside: number }[] = [];

  /** Columns that count another table's rows: what they should add up to, and what they do. */
  private readonly counts: { column: string; index: number; expected: number; table?: string; total: number }[] = [];

  observeRow(values: readonly string[]): void {
    for (const r of this.rules) r.observe(values);
    for (const k of this.counts) k.total += Number(values[k.index]) || 0;
    for (const f of this.followers) if (!f.allowed.has(values[f.index])) f.outside++;
    for (let c = 0; c < this.accs.length; c++) {
      const a = this.accs[c];
      if (this.derived.has(c)) continue;
      const text = values[c];
      if (a.naTokens.has(text)) {
        bump(a.naByToken, text);
        continue;
      }
      if (a.sentinelKeys.has(text)) {
        bump(a.sentinelByKey, text);
        continue;
      }
      if (a.distinct) {
        a.distinct.add(text); // how often each invented value appears, kept as hashes
        if (a.col.type === "personal" || a.col.type === "short_string") {
          if (text.length < a.lenMin) a.lenMin = text.length;
          if (text.length > a.lenMax) a.lenMax = text.length;
        }
      } else if (isCategorical(a.col)) {
        bump(a.labels, text);
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
    for (const [i, a] of this.accs.entries()) {
      if (this.derived.has(i)) continue;
      const col = a.col;
      if (col.type === "unsupported") continue; // written as all-NA; nothing to compare
      const add = (metric: CheckRow["metric"], target: string, achieved: string, pass: boolean) =>
        rows.push({ column: col.name, metric, target, achieved, pass });

      // NA counts, per token.
      const naTarget = col.na?.by_token
        ? { ...col.na.by_token }
        : col.na
          ? { [col.na.tokens[0] ?? ""]: col.na.count }
          : {};
      const naAchieved = toObject(a.naByToken);
      if (col.type === "empty") {
        add(
          "na_count",
          show(sortedObject(naTarget)),
          show(naAchieved),
          sameCounts(sortedObject(naTarget), naAchieved),
        );
        continue;
      }
      if (col.na || a.naByToken.size > 0) {
        add(
          "na_count",
          show(sortedObject(naTarget)),
          show(naAchieved),
          sameCounts(sortedObject(naTarget), naAchieved),
        );
      }

      if (col.sentinels && Object.keys(col.sentinels).length > 0) {
        const got = toObject(a.sentinelByKey);
        add(
          "sentinel_counts",
          show(sortedObject(col.sentinels)),
          show(got),
          sameCounts(sortedObject(col.sentinels), got),
        );
      }

      if (isCategorical(col)) {
        const want = sortedObject(effectiveCounts(col.counts, col));
        const got = toObject(a.labels);
        add("label_counts", show(want), show(got), sameCounts(want, got));
      } else if (
        col.type === "survey_id" ||
        col.type === "personal" ||
        col.type === "short_string"
      ) {
        // How many values appear once, twice, three times: the repeat structure must be reproduced
        // exactly, and with it the distinct count.
        const { structure, distinct } = a.distinct
          ? a.distinct.finish()
          : { structure: {}, distinct: 0 };
        const want = sortedObject(col.repeat_structure);
        const wantDistinct = Object.values(want).reduce((x, y) => x + y, 0);
        add("distinct_count", String(wantDistinct), String(distinct), distinct === wantDistinct);
        add(
          "repeat_structure",
          show(want),
          show(sortedObject(structure)),
          sameCounts(want, sortedObject(structure)),
        );
        if (col.type === "short_string") {
          const lengths = Object.keys(col.length_groups).map(Number);
          const wantMin = Math.min(...lengths);
          const wantMax = Math.max(...lengths);
          add(
            "length_min",
            String(wantMin),
            a.lenMax > 0 ? String(a.lenMin) : "n/a",
            a.lenMax > 0 && a.lenMin === wantMin,
          );
          add(
            "length_max",
            String(wantMax),
            a.lenMax > 0 ? String(a.lenMax) : "n/a",
            a.lenMax > 0 && a.lenMax === wantMax,
          );
        }
      } else if (isNumericLike(col)) {
        add("min", String(col.min), a.n > 0 ? String(a.min) : "n/a", a.n > 0 && a.min === col.min);
        add("max", String(col.max), a.n > 0 ? String(a.max) : "n/a", a.n > 0 && a.max === col.max);
        // Mean and sd are only targets when the column uses a fitted beta (match_mean_sd).
        if (
          col.mode === "match_mean_sd" &&
          col.mean !== undefined &&
          col.sd !== undefined &&
          fitBeta(col.mean, col.sd, col.min, col.max)
        ) {
          const mean = a.mean;
          const sd = a.n > 0 ? Math.sqrt(a.m2 / a.n) : 0;
          add("mean", String(col.mean), String(mean), meanClose(mean, col.mean, col.sd));
          add("sd", String(col.sd), String(sd), sdClose(sd, col.sd));
        }
      }
    }
    for (const r of this.rules) rows.push(r.row());
    for (const f of this.followers)
      rows.push({
        column: f.column,
        metric: "parent_values",
        target: `only values of ${f.table ?? "the other table"}`,
        achieved: `${f.outside.toLocaleString("en-US")} other`,
        pass: f.outside === 0,
      });
    for (const k of this.counts)
      rows.push({
        column: k.column,
        metric: "children",
        target: `${k.expected.toLocaleString("en-US")}${k.table ? ` in ${k.table}` : ""}`,
        achieved: k.total.toLocaleString("en-US"),
        pass: k.total === k.expected,
      });
    return rows;
  }
}

interface RuleCheck {
  observe(values: readonly string[]): void;
  row(): CheckRow;
}

/** Checks one rule on the written text: how many rows break it (none when the rule holds in every row). */
function makeRuleCheck(rule: RuleSpec, plan: TablePlan, index: Map<string, number>): RuleCheck {
  const t = index.get(rule.column);
  const sourceName =
    rule.kind === "follows"
      ? rule.after
      : rule.kind === "blank_with"
        ? rule.with
        : rule.when_column;
  const s = index.get(sourceName);
  const target = plan.columns.find((c) => c.name === rule.column)?.spec;
  const source = plan.columns.find((c) => c.name === sourceName)?.spec;
  let broken = 0;
  let seen = 0;
  const say = (achieved: string, pass: boolean): CheckRow => ({
    column: rule.column,
    metric: "rule",
    target: describeRule(rule),
    achieved,
    pass,
  });

  if (t === undefined || s === undefined || !target || !source) {
    return {
      observe: () => {},
      row: () => say("not checked: a column of the rule is left out of the file", true),
    };
  }

  const dateLike = (c: ColumnSpec): c is DateColumn =>
    c.type === "date" || c.type === "datetime" || c.type === "time";
  const seconds = (text: string, c: DateColumn): number | null => {
    const d = parseDate(text, c.format);
    if (!d) return null;
    const v = dateToNumber(d, patternKind(c.format));
    return patternKind(c.format) === "date" ? v * 86400 : v;
  };

  return {
    observe(values) {
      seen++;
      const a = values[s];
      const b = values[t];
      switch (rule.kind) {
        case "follows": {
          if (isBlank(source, a) || (source.sentinels && a in source.sentinels)) {
            if (!isBlank(target, b)) broken++;
            return;
          }
          let gap: number | null;
          if (dateLike(source) && dateLike(target)) {
            const x = seconds(a, source);
            const y = seconds(b, target);
            gap = x === null || y === null ? null : (y - x) / (target.type === "date" ? 86400 : 1);
          } else {
            const x = Number(a.replace(/,/g, ""));
            const y = Number(b.replace(/,/g, ""));
            gap = Number.isFinite(x) && Number.isFinite(y) ? y - x : null;
          }
          if (gap === null || gap < rule.min - 1e-9 || gap > rule.max + 1e-9) broken++;
          return;
        }
        case "blank_with":
          if (isBlank(source, a) && !isBlank(target, b)) broken++;
          return;
        case "set_when":
          if (a === rule.when_value && b !== rule.value) broken++;
          return;
      }
    },
    row: () =>
      say(
        broken === 0
          ? `holds in all ${seen.toLocaleString("en-US")} rows`
          : `${broken.toLocaleString("en-US")} rows break it`,
        broken === 0,
      ),
  };
}
