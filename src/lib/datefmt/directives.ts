// One shared table of date/time pattern directives. The same table drives the TypeScript
// formatter/parser here and the translation to DuckDB's strptime on the profiling side, so the two
// can never disagree about a pattern (research.md R8). A closed set also keeps the user-typed
// pattern box safe: anything outside the table is rejected.
//
// Supported: %Y %y %m %d %H %I %M %S %p %b %B %j plus literal text. No time zones.

export type PatternKind = "date" | "time" | "datetime";
export type Granularity = "day" | "minute" | "second";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DATE_DIRECTIVES = new Set(["Y", "y", "m", "d", "b", "B", "j"]);
const TIME_DIRECTIVES = new Set(["H", "I", "M", "S", "p"]);
const SUPPORTED = new Set([...DATE_DIRECTIVES, ...TIME_DIRECTIVES]);

const pad = (n: number, width: number) => String(n).padStart(width, "0");

interface Token {
  directive: string | null;
  text: string;
}

/** Splits a pattern into directive and literal tokens. Returns null if it has an unsupported one. */
function tokenize(pattern: string): Token[] | null {
  const tokens: Token[] = [];
  let literal = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch !== "%") {
      literal += ch;
      continue;
    }
    const code = pattern[i + 1];
    if (code === undefined || !SUPPORTED.has(code)) return null;
    if (literal) tokens.push({ directive: null, text: literal });
    literal = "";
    tokens.push({ directive: code, text: `%${code}` });
    i++;
  }
  if (literal) tokens.push({ directive: null, text: literal });
  return tokens;
}

export function isSupportedPattern(pattern: string): boolean {
  if (pattern.length === 0) return false;
  const tokens = tokenize(pattern);
  return tokens !== null && tokens.some((t) => t.directive !== null);
}

function directivesOf(pattern: string): Set<string> {
  const tokens = tokenize(pattern);
  if (!tokens) throw new RangeError(`unsupported date pattern: ${pattern}`);
  return new Set(tokens.filter((t) => t.directive).map((t) => t.directive as string));
}

export function patternKind(pattern: string): PatternKind {
  const used = [...directivesOf(pattern)];
  const hasDate = used.some((d) => DATE_DIRECTIVES.has(d));
  const hasTime = used.some((d) => TIME_DIRECTIVES.has(d));
  if (hasDate && hasTime) return "datetime";
  return hasTime ? "time" : "date";
}

export function patternGranularity(pattern: string): Granularity {
  const used = directivesOf(pattern);
  if (used.has("S")) return "second";
  if (used.has("M") || used.has("H") || used.has("I")) return "minute";
  return "day";
}

/** DuckDB's strptime accepts these directives unchanged; this validates and returns the pattern. */
export function toDuckdbPattern(pattern: string): string {
  if (!isSupportedPattern(pattern)) throw new RangeError(`unsupported date pattern: ${pattern}`);
  return pattern;
}

/** Formats a date using UTC fields. */
export function formatDate(date: Date, pattern: string): string {
  const tokens = tokenize(pattern);
  if (!tokens) throw new RangeError(`unsupported date pattern: ${pattern}`);
  const hours = date.getUTCHours();
  const year = date.getUTCFullYear();
  const dayOfYear =
    Math.floor((Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) - Date.UTC(year, 0, 1)) / 86400000) + 1;
  return tokens
    .map((t) => {
      switch (t.directive) {
        case null:
          return t.text;
        case "Y":
          return pad(year, 4);
        case "y":
          return pad(year % 100, 2);
        case "m":
          return pad(date.getUTCMonth() + 1, 2);
        case "d":
          return pad(date.getUTCDate(), 2);
        case "H":
          return pad(hours, 2);
        case "I":
          return pad(hours % 12 || 12, 2);
        case "M":
          return pad(date.getUTCMinutes(), 2);
        case "S":
          return pad(date.getUTCSeconds(), 2);
        case "p":
          return hours < 12 ? "AM" : "PM";
        case "b":
          return MONTHS_SHORT[date.getUTCMonth()];
        case "B":
          return MONTHS_LONG[date.getUTCMonth()];
        case "j":
          return pad(dayOfYear, 3);
        default:
          return t.text;
      }
    })
    .join("");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parses text with a pattern, returning a UTC Date or null when the text does not match or is not a
 * real calendar date/time. A pattern with only time directives is placed on 1970-01-01.
 */
export function parseDate(text: string, pattern: string): Date | null {
  const tokens = tokenize(pattern);
  if (!tokens) return null;

  const order: string[] = [];
  const source = tokens
    .map((t) => {
      if (t.directive === null) return escapeRegex(t.text);
      order.push(t.directive);
      switch (t.directive) {
        case "Y":
          return "(\\d{4})";
        case "y":
          return "(\\d{2})";
        case "j":
          return "(\\d{1,3})";
        case "p":
          return "(AM|PM)";
        case "b":
          return `(${MONTHS_SHORT.join("|")})`;
        case "B":
          return `(${MONTHS_LONG.join("|")})`;
        default:
          return "(\\d{1,2})";
      }
    })
    .join("");

  const match = new RegExp(`^${source}$`, "i").exec(text);
  if (!match) return null;

  let year = 1970;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let dayOfYear: number | null = null;
  let pm = false;
  let hour12 = false;

  order.forEach((directive, i) => {
    const raw = match[i + 1];
    const num = Number(raw);
    switch (directive) {
      case "Y":
        year = num;
        break;
      case "y":
        year = num <= 68 ? 2000 + num : 1900 + num; // POSIX pivot, same as DuckDB
        break;
      case "m":
        month = num;
        break;
      case "d":
        day = num;
        break;
      case "H":
        hour = num;
        break;
      case "I":
        hour = num;
        hour12 = true;
        break;
      case "M":
        minute = num;
        break;
      case "S":
        second = num;
        break;
      case "p":
        pm = raw.toUpperCase() === "PM";
        break;
      case "b":
        month = MONTHS_SHORT.findIndex((m) => m.toLowerCase() === raw.toLowerCase()) + 1;
        break;
      case "B":
        month = MONTHS_LONG.findIndex((m) => m.toLowerCase() === raw.toLowerCase()) + 1;
        break;
      case "j":
        dayOfYear = num;
        break;
    }
  });

  if (hour12) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (pm ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || second > 59) return null;

  if (dayOfYear !== null) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    if (dayOfYear < 1 || dayOfYear > (leap ? 366 : 365)) return null;
    return new Date(Date.UTC(year, 0, dayOfYear, hour, minute, second));
  }

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Reject rollovers such as Feb 30 or month 13 by checking the fields came back unchanged.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

/** Number used while generating: days since epoch, seconds since epoch, or seconds since midnight. */
export function toNumber(date: Date, kind: PatternKind): number {
  const ms = date.getTime();
  if (kind === "date") return Math.floor(ms / 86400000);
  if (kind === "datetime") return Math.floor(ms / 1000);
  return date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds();
}

/** Inverse of toNumber. A time is placed on 1970-01-01 UTC. */
export function fromNumber(value: number, kind: PatternKind): Date {
  if (kind === "date") return new Date(value * 86400000);
  return new Date(value * 1000);
}
