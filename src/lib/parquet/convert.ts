// From the cell text the generators produce to typed Parquet values (specs/005 research R6, R6b). One
// converter per column holds the column's type and counts what it had to change: values clamped into the
// type's range ("narrowed") and text it could not read ("unparsed", written as null). Integers and decimals
// go through BigInt so 64-bit and 38-digit values are exact.

import { EMPTY_TEXT_TOKEN } from "../spec/types";
import { decimalBytesBE } from "./encode";
import { decimalBytes, decimalLimit, intRange, UNITS_PER_SECOND, type ParquetType } from "./types";

export type TypedValue = number | bigint | boolean | Uint8Array;

export interface ConvertStats {
  /** Values clamped into the range of the column's type. */
  narrowed: number;
  /** Text that was not a value of the column's type, written as null. */
  unparsed: number;
}

export interface Converter {
  /** The typed value for a cell text, or null for a null. */
  convert(text: string): TypedValue | null;
  stats: ConvertStats;
}

const encoder = new TextEncoder();

/** Days since 1970-01-01 of a proleptic Gregorian date, or null when the date does not exist. */
function daysFromCivil(year: number, month: number, day: number): number | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const length = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > length) return null;
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?)?(?:Z|[+-]00(?::?00)?)?$/;
const TIME = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/;

/** Fractional digits (one to nine) as a count of the unit. */
function fraction(digits: string | undefined, perSecond: bigint): bigint {
  if (!digits) return 0n;
  return BigInt(digits.padEnd(9, "0")) / (1_000_000_000n / perSecond);
}

/** A decimal's unscaled integer from text, rounding extra digits half away from zero; null when unreadable. */
function unscaledDecimal(text: string, scale: number): bigint | null {
  const plain = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(text);
  if (plain) {
    const [, sign, whole, frac = ""] = plain;
    const padded = frac.padEnd(scale, "0");
    let value = BigInt(whole + padded.slice(0, scale));
    if (frac.length > scale && padded.charCodeAt(scale) >= 53) value += 1n; // next digit 5 to 9 rounds away from zero
    return sign === "-" ? -value : value;
  }
  // Exponent forms: only when a double holds the value exactly enough to round to the scale.
  const n = Number(text);
  if (!Number.isFinite(n) || !/^[+-]?\d*\.?\d+(?:e[+-]?\d+)?$/i.test(text) || Math.abs(n) >= 1e15) return null;
  return unscaledDecimal(n.toFixed(scale), scale);
}

export function createConverter(type: ParquetType): Converter {
  const stats: ConvertStats = { narrowed: 0, unparsed: 0 };
  const bad = (): null => {
    stats.unparsed++;
    return null;
  };

  const convert = ((): ((text: string) => TypedValue | null) => {
    switch (type.kind) {
      case "string":
        return (text) => (text === EMPTY_TEXT_TOKEN ? new Uint8Array() : encoder.encode(text));

      case "int": {
        const { min, max } = intRange(type.bits as number, type.signed as boolean);
        const big = (type.bits as number) === 64;
        return (text) => {
          let v: bigint;
          if (/^[+-]?\d+$/.test(text)) v = BigInt(text);
          else {
            const n = Number(text);
            if (text.trim() === "" || !Number.isFinite(n)) return bad();
            v = BigInt(Math.round(n));
          }
          if (v < min) {
            v = min;
            stats.narrowed++;
          } else if (v > max) {
            v = max;
            stats.narrowed++;
          }
          return big ? v : Number(v);
        };
      }

      case "float":
        return (text) => {
          const n = Number(text);
          if (text.trim() === "" || !Number.isFinite(n)) return bad();
          return n;
        };

      case "decimal": {
        const precision = type.precision as number;
        const scale = type.scale as number;
        const limit = decimalLimit(precision);
        const length = decimalBytes(precision);
        return (text) => {
          let v = unscaledDecimal(text.trim(), scale);
          if (v === null) return bad();
          if (v > limit) {
            v = limit;
            stats.narrowed++;
          } else if (v < -limit) {
            v = -limit;
            stats.narrowed++;
          }
          if (precision <= 9) return Number(v);
          if (precision <= 18) return v;
          return decimalBytesBE(v, length);
        };
      }

      case "bool":
        return (text) => {
          const t = text.trim().toLowerCase();
          if (t === "true" || t === "1") return true;
          if (t === "false" || t === "0") return false;
          return bad();
        };

      case "date":
        return (text) => {
          const m = DATE_TIME.exec(text);
          const days = m ? daysFromCivil(Number(m[1]), Number(m[2]), Number(m[3])) : null;
          return days === null ? bad() : days;
        };

      case "time": {
        const unit = type.unit as "ms" | "us" | "ns";
        const perSecond = UNITS_PER_SECOND[unit];
        return (text) => {
          const m = TIME.exec(text);
          if (!m || Number(m[1]) > 23 || Number(m[2]) > 59 || Number(m[3]) > 59) return bad();
          const seconds = BigInt(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
          const v = seconds * perSecond + fraction(m[4], perSecond);
          return unit === "ms" ? Number(v) : v;
        };
      }

      case "timestamp": {
        const perSecond = UNITS_PER_SECOND[type.unit as "ms" | "us" | "ns"];
        return (text) => {
          const m = DATE_TIME.exec(text);
          const days = m ? daysFromCivil(Number(m[1]), Number(m[2]), Number(m[3])) : null;
          if (!m || days === null) return bad();
          const h = Number(m[4] ?? 0);
          const mi = Number(m[5] ?? 0);
          const s = Number(m[6] ?? 0);
          if (h > 23 || mi > 59 || s > 59) return bad();
          const seconds = BigInt(days) * 86400n + BigInt(h * 3600 + mi * 60 + s);
          // A fraction counts forward in time, also before 1970 (-0.5 s before 1970-01-01 00:00:00 is :59.5).
          return seconds * perSecond + fraction(m[7], perSecond);
        };
      }
    }
  })();

  return {
    stats,
    convert(text) {
      if (text === "") return null;
      if (text === EMPTY_TEXT_TOKEN) return type.kind === "string" ? new Uint8Array() : null;
      return convert(text);
    },
  };
}
