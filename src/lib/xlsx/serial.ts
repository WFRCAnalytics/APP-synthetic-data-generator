// Excel serial numbers (specs/003 FR-005, research R6). A date in a workbook is a number of days from an
// epoch plus a fraction of a day for the time. The 1900 system counts from 1900-01-01 as day 1 and
// wrongly has a 29 February 1900 (serial 60); the 1904 system counts from 1904-01-01 as day 0.
// The app keeps dates as ISO text (YYYY-MM-DD, YYYY-MM-DD HH:MM:SS, HH:MM:SS); this module converts
// at the edge. Only dates and times that exist in the chosen system convert; others give null.

const DAY_MS = 86_400_000;
const EPOCH_1900 = Date.UTC(1899, 11, 30); // serial 0 for dates from 1900-03-01 on
const EPOCH_1904 = Date.UTC(1904, 0, 1);
const FIRST_1900 = Date.UTC(1900, 0, 1);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const ISO_TIME = /^(\d{2}):(\d{2}):(\d{2})$/;

function validDate(y: number, m: number, d: number): number | null {
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d ? t : null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function secondsOfDay(h: number, mi: number, s: number): number | null {
  return h < 24 && mi < 60 && s < 60 ? h * 3600 + mi * 60 + s : null;
}

/** The serial number of ISO text, or null when the text is not a date or time that exists in the system. */
export function isoToSerial(iso: string, date1904: boolean): number | null {
  let day: number | null = null;
  let secs = 0;

  const t = ISO_TIME.exec(iso);
  if (t) {
    const s = secondsOfDay(Number(t[1]), Number(t[2]), Number(t[3]));
    return s === null ? null : s / 86400;
  }

  let ms: number | null = null;
  const d = ISO_DATE.exec(iso);
  const dt = ISO_DATETIME.exec(iso);
  if (d) ms = validDate(Number(d[1]), Number(d[2]), Number(d[3]));
  else if (dt) {
    ms = validDate(Number(dt[1]), Number(dt[2]), Number(dt[3]));
    const s = secondsOfDay(Number(dt[4]), Number(dt[5]), Number(dt[6]));
    if (s === null) return null;
    secs = s;
  }
  if (ms === null) return null;

  if (date1904) {
    if (ms < EPOCH_1904) return null;
    day = Math.round((ms - EPOCH_1904) / DAY_MS);
  } else {
    if (ms < FIRST_1900) return null;
    day = Math.round((ms - EPOCH_1900) / DAY_MS);
    if (day < 61) day -= 1; // before 1900-03-01 the imaginary 29 February 1900 is not yet counted
  }
  return secs === 0 ? day : day + secs / 86400;
}

/** The ISO text of a serial number, in the kind asked for ("date", "datetime" or "time"); null when it is not a real date. */
export function serialToIso(serial: number, date1904: boolean, kind: "date" | "datetime" | "time"): string | null {
  if (!Number.isFinite(serial)) return null;
  let whole = Math.floor(serial);
  let secs = Math.round((serial - whole) * 86400);
  if (secs === 86400) {
    whole += 1;
    secs = 0;
  }
  if (kind === "time") {
    const s = ((secs % 86400) + 86400) % 86400;
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  }

  let ms: number;
  if (date1904) {
    if (whole < 0) return null;
    ms = EPOCH_1904 + whole * DAY_MS;
  } else {
    if (whole < 1 || whole === 60) return null;
    ms = EPOCH_1900 + (whole < 60 ? whole + 1 : whole) * DAY_MS;
  }
  const date = new Date(ms);
  const text = `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  return kind === "date" ? text : `${text} ${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}`;
}
