// Profiling personal identifier, free text and short string columns (specs/002 FR-008, research R4,
// R7, R7a). Every query here returns counts, lengths and character-class shapes (9 for a digit, A for a
// letter, U and L for the two cases) and nothing else: no value of these columns is ever read into
// memory. The only characters that come back are punctuation and spaces that are part of a shape.

import { MAX_LENGTH_GROUPS, MAX_TEXT_LENGTH } from "../../lib/spec/types";
import type { MaskToken, PersonalFormat, PersonalKind } from "../../lib/spec/types";
import { repeatStructure } from "./ids";
import { shapeOf, SRC, toNumber, type SqlRunner } from "./sql";

/** A shape with the two letter cases kept apart: 9 digit, U upper case, L lower case, punctuation as it is. */
const caseShapeOf = (col: string): string =>
  `regexp_replace(regexp_replace(regexp_replace(left(${col}, 65), '[0-9]', '9', 'g'), '[A-Z]', 'U', 'g'), '[a-z]', 'L', 'g')`;

export interface PersonalAggregates {
  repeatStructure: Record<string, number>;
  distinct: number;
  format?: PersonalFormat;
}

/** Repeat structure and the format classes a kind keeps. */
export async function profilePersonal(sql: SqlRunner, c: string, where: string, kind: PersonalKind): Promise<PersonalAggregates> {
  const { structure, distinct } = await repeatStructure(sql, c, where);
  const out: PersonalAggregates = { repeatStructure: structure, distinct };
  const [{ n }] = await sql.all(`SELECT count(*) AS n FROM ${SRC} WHERE ${where}`);
  const total = Math.max(1, toNumber(n));

  switch (kind) {
    case "phone": {
      const rows = await sql.all(`SELECT ${shapeOf(c)} AS shape, count(*) AS k FROM ${SRC} WHERE ${where} GROUP BY 1 ORDER BY k DESC, shape LIMIT 40`);
      // Keep the shapes of 7, 10 or 11 digits (the others are not phone numbers), at most five.
      const phoneShapes = rows
        .map((r) => ({ shape: String(r.shape), count: toNumber(r.k) }))
        .filter((r) => [7, 10, 11].includes((r.shape.match(/9/g) ?? []).length))
        .slice(0, 5);
      const kept = phoneShapes.reduce((a, r) => a + r.count, 0);
      if (kept > 0) out.format = { shapes: phoneShapes.map((r) => ({ shape: r.shape, share: Math.round((r.count / kept) * 1000) / 1000 })) };
      break;
    }
    case "ssn": {
      const [row] = await sql.all(`SELECT ${shapeOf(c)} AS shape, count(*) AS k FROM ${SRC} WHERE ${where} GROUP BY 1 ORDER BY k DESC, shape LIMIT 1`);
      if (row) out.format = { shape: String(row.shape) };
      break;
    }
    case "full_name": {
      const [row] = await sql.all(`SELECT count(*) FILTER (WHERE position(',' IN ${c}) > 0) AS k FROM ${SRC} WHERE ${where}`);
      if (toNumber(row.k) * 2 >= total) out.format = { last_first: true };
      break;
    }
    case "address": {
      const unit = String.raw`'(^|[ ,])(apt|suite|unit|ste)\.?[ #]?[0-9a-z]|#[0-9]'`;
      const [row] = await sql.all(`SELECT count(*) FILTER (WHERE regexp_matches(lower(${c}), ${unit})) AS k FROM ${SRC} WHERE ${where}`);
      if (toNumber(row.k) * 10 >= total * 3) out.format = { unit: true };
      break;
    }
    default:
      break;
  }
  return out;
}

export interface FreeTextAggregates {
  lineBreaks: boolean;
  /** Values longer than the cap, counted at the cap. */
  capped: number;
}

export async function freeTextFlags(sql: SqlRunner, c: string, where: string): Promise<FreeTextAggregates> {
  const [row] = await sql.all(
    `SELECT count(*) FILTER (WHERE position(chr(10) IN ${c}) > 0 OR position(chr(13) IN ${c}) > 0) AS breaks,
            count(*) FILTER (WHERE length(${c}) > ${MAX_TEXT_LENGTH}) AS capped
     FROM ${SRC} WHERE ${where}`,
  );
  return { lineBreaks: toNumber(row.breaks) > 0, capped: toNumber(row.capped) };
}

export interface ShortStringAggregates {
  pattern: MaskToken[];
  lengthGroups: Record<string, number>;
  repeatStructure: Record<string, number>;
  distinct: number;
}

const MAX_SHAPES = 5000;

/** Per-position token from the character classes seen at that position across all shapes. */
function tokenFromClasses(classes: ReadonlySet<string>): MaskToken {
  const literals = [...classes].filter((x) => !"9UL".includes(x));
  const hasDigit = classes.has("9");
  const hasUpper = classes.has("U");
  const hasLower = classes.has("L");
  if (literals.length === 1 && !hasDigit && !hasUpper && !hasLower) return { literal: literals[0] };
  if (literals.length > 0) return "alnum"; // symbols that vary are not representable; allow anything
  if (hasDigit && (hasUpper || hasLower)) return "alnum";
  if (hasDigit) return "digit";
  if (hasUpper && hasLower) return "letter";
  return hasUpper ? "upper" : "lower";
}

export async function profileShortString(sql: SqlRunner, c: string, where: string): Promise<ShortStringAggregates> {
  const { structure, distinct } = await repeatStructure(sql, c, where);

  // Distinct values per length: the spread of lengths the generated column must follow.
  const lengthRows = await sql.all(`SELECT length(${c}) AS len, count(DISTINCT ${c}) AS k FROM ${SRC} WHERE ${where} GROUP BY 1 ORDER BY 1 LIMIT ${MAX_LENGTH_GROUPS + 1}`);
  const lengthGroups: Record<string, number> = {};
  for (const r of lengthRows.slice(0, MAX_LENGTH_GROUPS)) lengthGroups[String(toNumber(r.len))] = toNumber(r.k);
  const longest = Math.max(1, ...Object.keys(lengthGroups).map(Number));

  const shapeRows = await sql.all(`SELECT ${caseShapeOf(c)} AS shape FROM ${SRC} WHERE ${where} GROUP BY 1 LIMIT ${MAX_SHAPES + 1}`);
  let pattern: MaskToken[];
  if (shapeRows.length > MAX_SHAPES) {
    pattern = Array.from({ length: longest }, () => "alnum" as const);
  } else {
    const perPosition: Set<string>[] = Array.from({ length: longest }, () => new Set<string>());
    for (const r of shapeRows) {
      const shape = String(r.shape);
      for (let i = 0; i < Math.min(shape.length, longest); i++) perPosition[i].add(shape[i]);
    }
    pattern = perPosition.map((classes) => (classes.size === 0 ? ("alnum" as const) : tokenFromClasses(classes)));
  }
  return { pattern, lengthGroups, repeatStructure: structure, distinct };
}
