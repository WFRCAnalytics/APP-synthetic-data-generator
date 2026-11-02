// What a fake column keeps from the real one (specs/032). A person chooses, per column, how closely the spec follows the real
// summary; the spec then holds only what was chosen, so a choice that keeps less never writes the real figure. Pure functions on
// spec columns: nothing here reads a row, and every choice only ever coarsens a summary the profile already made.

import type { ColumnSpec, NaSpec } from "../spec/types";

/** How often each label appears: as it is, rounded to a share of the rows, or the same for every label. */
export type CountsKeep = "exact" | "rounded" | "equal";
/** How many rows have no value: as it is, rounded to a share of the rows, or none. */
export type MissingKeep = "exact" | "rounded" | "none";
/** The lowest and highest value: as it is, or widened outward to a rounder figure. */
export type RangeKeep = "exact" | "rounded";

export interface Keep {
  counts?: CountsKeep;
  missing?: MissingKeep;
  range?: RangeKeep;
}

export type NumberShape = "match_shape" | "match_mean_sd" | "uniform";

export type Preset = "close" | "balanced" | "private";

export const PRESETS: readonly { id: Preset; label: string; note: string }[] = [
  { id: "close", label: "Match closely", note: "Keeps the real counts, ranges and shapes as they are. Closest to the real table, and reveals the most." },
  { id: "balanced", label: "Balanced", note: "Rounds counts and ranges a little and keeps averages and spreads. A good start for most tables." },
  { id: "private", label: "Most private", note: "Gives every label the same share, rounds ranges, spreads numbers evenly and leaves out missing values." },
];

/** What a preset chooses for every column. */
export function presetChoices(preset: Preset): { keep: Required<Keep>; shape: NumberShape } {
  switch (preset) {
    case "close":
      return { keep: { counts: "exact", missing: "exact", range: "exact" }, shape: "match_shape" };
    case "private":
      return { keep: { counts: "equal", missing: "none", range: "rounded" }, shape: "uniform" };
    default:
      return { keep: { counts: "rounded", missing: "rounded", range: "rounded" }, shape: "match_mean_sd" };
  }
}

/** The step counts are rounded to: a share of the rows, never less than 5 rows. */
export const roundingUnit = (rows: number): number => Math.max(5, Math.round(rows / 100));

/** The weights scaled to add up to `total`, whole numbers, by the largest remainder. */
export function largestRemainder(weights: readonly number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum <= 0) {
    const base = Math.floor(total / weights.length);
    const out = weights.map(() => base);
    for (let i = 0; i < total - base * weights.length; i++) out[i]++;
    return out;
  }
  const exact = weights.map((w) => (w * total) / sum);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  return out;
}

/** An amount of rows rounded to the step, never negative. */
export const roundAmount = (count: number, rows: number): number => {
  const unit = roundingUnit(rows);
  return Math.max(0, Math.round(count / unit) * unit);
};

/**
 * Label counts that add up to `valueRows`: kept as they are when they already do and exactness is asked for, rounded to the step,
 * or the same for every label. A label never disappears while there are rows for it.
 */
export function shapeCounts(counts: Record<string, number>, valueRows: number, kind: CountsKeep, rows: number): Record<string, number> {
  const labels = Object.keys(counts);
  if (labels.length === 0) return {};
  const current = Object.values(counts).reduce((a, b) => a + b, 0);
  if (kind === "exact" && current === valueRows) return { ...counts };
  let weights: number[];
  if (kind === "equal") weights = labels.map(() => 1);
  else if (kind === "rounded") {
    const unit = roundingUnit(rows);
    weights = labels.map((l) => Math.max(1, Math.round(counts[l] / unit) * unit));
  } else weights = labels.map((l) => counts[l]);
  const share = largestRemainder(weights, valueRows);
  // A label with no row left is given one, taken from the largest, while there are enough rows to go round.
  if (valueRows >= labels.length) {
    for (let i = 0; i < share.length; i++) {
      if (share[i] > 0) continue;
      const big = share.indexOf(Math.max(...share));
      share[big]--;
      share[i] = 1;
    }
  }
  const out: Record<string, number> = {};
  labels.forEach((l, i) => {
    if (share[i] > 0) out[l] = share[i];
  });
  return out;
}

/** A number widened outward to two significant digits (12,345 to 12,000; 987,654 to 990,000). */
export function roundOutward(value: number, direction: "down" | "up"): number {
  if (value === 0 || !Number.isFinite(value)) return value;
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(value))) - 1);
  const scaled = value / magnitude;
  const rounded = direction === "down" ? Math.floor(scaled + 1e-9) : Math.ceil(scaled - 1e-9);
  return Number((rounded * magnitude).toPrecision(12));
}

const DAY = 86400;
const MONTH_START = (days: number): number => {
  const d = new Date(days * DAY * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / (DAY * 1000);
};
const MONTH_END = (days: number): number => {
  const d = new Date(days * DAY * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0) / (DAY * 1000);
};

/** The range widened outward: to whole months for dates, whole days for date-times, whole hours for times, two digits for numbers. */
export function roundRange(type: string, min: number, max: number, decimals = 0): { min: number; max: number } {
  let lo: number;
  let hi: number;
  switch (type) {
    case "date":
      lo = MONTH_START(min);
      hi = MONTH_END(max);
      break;
    case "datetime":
      lo = Math.floor(min / DAY) * DAY;
      hi = Math.ceil(max / DAY) * DAY;
      break;
    case "time":
      lo = Math.floor(min / 3600) * 3600;
      // The last whole minute of the day: a time column written to the minute cannot hold 23:59:59, and a real maximum above it is kept.
      hi = Math.min(86340, Math.ceil(max / 3600) * 3600);
      break;
    default: {
      lo = roundOutward(min, "down");
      hi = roundOutward(max, "up");
      if (decimals === 0) {
        lo = Math.floor(lo);
        hi = Math.ceil(hi);
      }
    }
  }
  return { min: Math.min(lo, min), max: Math.max(hi, max) };
}

const SHAPED = new Set(["categorical", "boolean", "integer", "float", "date", "datetime", "time"]);
const RANGED = new Set(["integer", "float", "date", "datetime", "time"]);

/** Whether the column's missing values can be changed without changing anything else about it. */
export const canChangeMissing = (type: string): boolean => SHAPED.has(type);

const sum = (o: Record<string, number> | undefined): number => Object.values(o ?? {}).reduce((a, b) => a + b, 0);

function shapeMissing(na: NaSpec, count: number): NaSpec {
  if (!na.by_token) return { ...na, count };
  const tokens = Object.keys(na.by_token);
  const parts = largestRemainder(tokens.map((t) => na.by_token?.[t] ?? 0), count);
  return { ...na, count, by_token: Object.fromEntries(tokens.map((t, i) => [t, parts[i]]).filter(([, n]) => (n as number) > 0)) };
}

/**
 * The column as the choices say: the missing count, the label counts and the range coarsened, and the choices written down. A column
 * with nothing to choose is returned as it was.
 */
export function applyKeep(col: ColumnSpec, keep: Keep, rows: number): ColumnSpec {
  if (!SHAPED.has(col.type) || col.from_parent) return col;
  const coordinate = "coordinate" in col && col.coordinate !== undefined;
  const out: ColumnSpec = { ...col };
  const record: Keep = {};

  // Missing values first: the label counts must add up to what is left.
  const wantMissing = keep.missing ?? "exact";
  const na = col.na;
  if (na) {
    const count = wantMissing === "none" ? 0 : wantMissing === "rounded" ? roundAmount(na.count, rows) : na.count;
    if (count === 0) delete out.na;
    else out.na = shapeMissing(na, count);
    record.missing = wantMissing;
  }

  if (col.type === "categorical" || col.type === "boolean") {
    const wantCounts = keep.counts ?? "exact";
    const valueRows = rows - (out.na?.count ?? 0) - sum(col.sentinels);
    (out as typeof col).counts = shapeCounts(col.counts, valueRows, wantCounts, rows);
    record.counts = wantCounts;
  }

  if (RANGED.has(col.type) && "min" in col && "max" in col && typeof col.min === "number" && typeof col.max === "number" && !coordinate) {
    const wantRange = keep.range ?? "exact";
    if (wantRange === "rounded") {
      const { min, max } = roundRange(col.type, col.min, col.max, "decimals" in col ? (col.decimals ?? 0) : 0);
      const target = out as typeof col & { min: number; max: number; quantiles?: number[] };
      target.min = min;
      target.max = max;
      if (target.quantiles && target.quantiles.length > 1) {
        const q = [...target.quantiles];
        q[0] = min;
        q[q.length - 1] = max;
        target.quantiles = q;
      }
    }
    record.range = wantRange;
  }

  if (Object.keys(record).length > 0) out.keep = record;
  return out;
}

/** Whether `keep` asks for nothing more than `done` already reflects (a missing choice means exact). */
export const sameKeep = (done: Keep, keep: Keep): boolean =>
  (Object.keys(keep) as (keyof Keep)[]).every((k) => (done[k] ?? "exact") === keep[k]);

/** A preset as the defaults for every column: what it keeps, and the shape of its numbers. */
export const presetDefaults = (preset: Preset): { keep: Required<Keep>; shape: NumberShape } => presetChoices(preset);
