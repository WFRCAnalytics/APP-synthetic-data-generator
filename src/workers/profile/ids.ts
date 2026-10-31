// Survey ID patterns from SQL aggregates (FR-014, research.md R4). No query here returns an ID value:
// the answers are lengths, character-class flags per position, a min and max for whole-number IDs,
// and how many IDs appear once, twice, three times. A character comes back for a position only when
// every ID has the same one there (a fixed prefix or separator), so real IDs never reach memory.

import { tokenForPosition } from "../../lib/mask/mask";
import type { MaskToken } from "../../lib/spec/types";
import { ident, SRC, toNumber, toNumberOrNull, type SqlRunner } from "./sql";

export interface IdSummary {
  mask: MaskToken[];
  min?: number;
  max?: number;
  padWidth?: number;
  /** Group size to the number of distinct IDs with that size. */
  repeatStructure: Record<string, number>;
  distinct: number;
  /** The IDs have different lengths, so the pattern is a general one (needs a look). */
  mixedLengths?: boolean;
}

/** IDs longer than this are not treated as patterns (the classifier already limits names to 24). */
const MAX_POSITIONS = 32;

/** How many IDs appear once, twice, three times and so on, for the rows that belong to the data. */
export async function repeatStructure(sql: SqlRunner, col: string, where: string): Promise<{ structure: Record<string, number>; distinct: number }> {
  const rows = await sql.all(
    `SELECT cnt, count(*) AS groups FROM (SELECT count(*) AS cnt FROM ${SRC} WHERE ${where} GROUP BY ${col}) GROUP BY cnt ORDER BY cnt`,
  );
  const structure: Record<string, number> = {};
  let distinct = 0;
  for (const r of rows) {
    const groups = toNumber(r.groups);
    structure[String(toNumber(r.cnt))] = groups;
    distinct += groups;
  }
  return { structure, distinct };
}

export async function profileIds(sql: SqlRunner, name: string, where: string): Promise<IdSummary> {
  const c = ident(name);
  const { structure, distinct } = await repeatStructure(sql, c, where);

  const [shape] = await sql.all(
    String.raw`SELECT count(*) AS n,
       count(*) FILTER (WHERE regexp_matches(${c}, '^\d+$') AND try_cast(${c} AS BIGINT) IS NOT NULL) AS whole,
       count(*) FILTER (WHERE regexp_matches(${c}, '^0\d')) AS leading_zero,
       coalesce(min(length(${c})), 0) AS min_len,
       coalesce(max(length(${c})), 0) AS max_len,
       min(try_cast(${c} AS BIGINT)) AS lo,
       max(try_cast(${c} AS BIGINT)) AS hi
     FROM ${SRC} WHERE ${where}`,
  );
  const n = toNumber(shape.n);
  const minLen = toNumber(shape.min_len);
  const maxLen = toNumber(shape.max_len);
  if (n === 0 || maxLen === 0 || maxLen > MAX_POSITIONS) return { mask: [], repeatStructure: structure, distinct };

  // Whole-number IDs: a pattern of digits, bounded by their min and max, padded when they were.
  const leadingZero = toNumber(shape.leading_zero);
  if (toNumber(shape.whole) === n && (leadingZero === 0 || minLen === maxLen)) {
    return {
      mask: Array.from({ length: maxLen }, () => "digit" as const),
      min: toNumberOrNull(shape.lo) ?? undefined,
      max: toNumberOrNull(shape.hi) ?? undefined,
      padWidth: leadingZero > 0 ? maxLen : 0,
      repeatStructure: structure,
      distinct,
    };
  }

  // Codes with letters or separators: read each position of the commonest length.
  const [common] = await sql.all(`SELECT length(${c}) AS len, count(*) AS k FROM ${SRC} WHERE ${where} GROUP BY 1 ORDER BY k DESC, len LIMIT 1`);
  const length = toNumber(common.len);

  // Mixed lengths cannot be one position-by-position pattern, and the commonest length alone could
  // allow fewer IDs than the column needs. Use a general pattern as long as the longest ID.
  if (toNumber(common.k) < n * 0.98) {
    return { mask: Array.from({ length: maxLen }, () => "alnum" as const), repeatStructure: structure, distinct, mixedLengths: true };
  }
  const ofLength = `${where} AND length(${c}) = ${length}`;
  const columns: string[] = [];
  for (let i = 1; i <= length; i++) {
    const ch = `substr(${c}, ${i}, 1)`;
    columns.push(
      `count(DISTINCT ${ch}) AS d${i}`,
      `CASE WHEN count(DISTINCT ${ch}) = 1 THEN min(${ch}) END AS f${i}`,
      `bool_and(regexp_matches(${ch}, '[0-9]')) AS dg${i}`,
      `bool_and(regexp_matches(${ch}, '[A-Z]')) AS up${i}`,
      `bool_and(regexp_matches(${ch}, '[a-z]')) AS lo${i}`,
      `bool_and(regexp_matches(${ch}, '[A-Za-z]')) AS lt${i}`,
    );
  }
  const [row] = await sql.all(`SELECT ${columns.join(", ")} FROM ${SRC} WHERE ${ofLength}`);
  const mask: MaskToken[] = [];
  for (let i = 1; i <= length; i++) {
    mask.push(
      tokenForPosition({
        distinct: toNumber(row[`d${i}`]),
        first: String(row[`f${i}`] ?? ""),
        allDigits: row[`dg${i}`] === true,
        allUpper: row[`up${i}`] === true,
        allLower: row[`lo${i}`] === true,
        allLetters: row[`lt${i}`] === true,
      }),
    );
  }
  return { mask, repeatStructure: structure, distinct };
}
