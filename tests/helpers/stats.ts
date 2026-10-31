// Builds BasicStats for classifier tests without a database. Defaults describe a clean column of
// 1000 rows; each test overrides what matters.

import type { BasicStats, ShapeCount, ValueCount } from "../../src/lib/classify/stats";

export function makeStats(over: Partial<BasicStats> & { name: string }): BasicStats {
  const rowCount = over.rowCount ?? 1000;
  const valueCount = over.valueCount ?? rowCount;
  return {
    rowCount,
    nullCount: 0,
    tokenCounts: {},
    distinct: 10,
    valueCount,
    topValues: [],
    shapes: [],
    shapeSample: Math.min(valueCount, 50000),
    intCount: 0,
    floatCount: 0,
    thousandsCount: 0,
    plainBigCount: 0,
    leadingZeroCount: 0,
    sciCount: 0,
    unparsedCount: 0,
    unparsedTop: [],
    unparsedDistinct: 0,
    negativeCount: 0,
    p99: null,
    minLength: 1,
    maxLength: 4,
    meanLength: 2,
    ...over,
  };
}

/** A column of whole numbers. */
export function integers(name: string, over: Partial<BasicStats> = {}): BasicStats {
  const valueCount = over.valueCount ?? 1000;
  return makeStats({ name, valueCount, intCount: valueCount, floatCount: valueCount, distinct: 500, ...over });
}

/** A column of decimals. */
export function floats(name: string, over: Partial<BasicStats> = {}): BasicStats {
  const valueCount = over.valueCount ?? 1000;
  return makeStats({ name, valueCount, intCount: 0, floatCount: valueCount, distinct: 900, ...over });
}

/** A column of strings with the given shapes (counts out of the sample). */
export function strings(name: string, shapes: ShapeCount[], over: Partial<BasicStats> = {}): BasicStats {
  const valueCount = over.valueCount ?? 1000;
  return makeStats({
    name,
    valueCount,
    shapes,
    shapeSample: shapes.reduce((a, s) => a + s.count, 0),
    distinct: 900,
    maxLength: 20,
    meanLength: 12,
    // Text: nothing parses as a number.
    unparsedCount: valueCount,
    unparsedDistinct: over.distinct ?? 900,
    ...over,
  });
}

export const top = (pairs: [string, number][]): ValueCount[] => pairs.map(([value, count]) => ({ value, count }));
