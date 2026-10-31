// NA token detection (FR-008): which tokens this column uses for "missing", with exact counts, so
// the export uses the same ones.

import type { BasicStats } from "./stats";

export interface NaInfo {
  /** Tokens in a stable order: the empty field first (if used), then by count. */
  tokens: string[];
  byToken: Record<string, number>;
  count: number;
}

export function detectNa(stats: Pick<BasicStats, "nullCount" | "tokenCounts">): NaInfo {
  const byToken: Record<string, number> = {};
  const tokens: string[] = [];
  if (stats.nullCount > 0) {
    tokens.push("");
    byToken[""] = stats.nullCount;
  }
  const found = Object.entries(stats.tokenCounts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [token, n] of found) {
    tokens.push(token);
    byToken[token] = n;
  }
  const count = Object.values(byToken).reduce((a, b) => a + b, 0);
  return { tokens, byToken, count };
}

/** Adds extra tokens (for example stray non-numeric markers in a numeric column). */
export function withExtraTokens(info: NaInfo, extra: { value: string; count: number }[]): NaInfo {
  const byToken = { ...info.byToken };
  const tokens = [...info.tokens];
  for (const { value, count } of extra) {
    if (byToken[value] === undefined) tokens.push(value);
    byToken[value] = (byToken[value] ?? 0) + count;
  }
  return { tokens, byToken, count: Object.values(byToken).reduce((a, b) => a + b, 0) };
}
