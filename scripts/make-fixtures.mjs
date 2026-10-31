// Deterministic test fixtures for the "type zoo" (specs/001-csv-synthetic-slice/contracts/
// fixture-matrix.md). Every column has a known expected result, written to expected.json, so
// classification tests can assert column by column.
//
//   node scripts/make-fixtures.mjs            small zoo, ids_50k, file-level variants (committed)
//   node scripts/make-fixtures.mjs --100k     .fixtures/zoo_100k.csv (not committed)
//   node scripts/make-fixtures.mjs --large    .fixtures/zoo_500mb.csv (~500 MB, not committed)
//
// All data is fake. The "real" personal values are built from made-up syllables below, NOT from
// faker's word lists, so a leak test can tell a real fixture value from a value the app invents
// (the app composes its values from faker's lists). Phone numbers use the 555 exchange, addresses
// and names use the made-up syllables, IPs use the documentation ranges, emails use example.org.

import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEED = 20261030;
const ZOO_DIR = join(root, "tests", "fixtures", "zoo");
const BIG_DIR = join(root, ".fixtures");

// ---------------------------------------------------------------- randomness (per column)

function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rngFor = (name) => mulberry32((hashString(name) ^ SEED) >>> 0);
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const intIn = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const pad = (n, w) => String(n).padStart(w, "0");
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
// Cycles through every label first so each one is guaranteed to appear, then samples.
const coverAll = (labels) => (i, r) => (i < labels.length ? labels[i] : pick(r, labels));
// Replaces a share of values with a token (NA marker or sentinel).
const withToken = (gen, rate, token) => (i, r) => (r() < rate ? token : gen(i, r));

// ---------------------------------------------------------------- date formatting

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmt(d, pattern) {
  const h12 = d.getUTCHours() % 12 || 12;
  const map = {
    "%Y": pad(d.getUTCFullYear(), 4),
    "%m": pad(d.getUTCMonth() + 1, 2),
    "%d": pad(d.getUTCDate(), 2),
    "%H": pad(d.getUTCHours(), 2),
    "%M": pad(d.getUTCMinutes(), 2),
    "%S": pad(d.getUTCSeconds(), 2),
    "%I": pad(h12, 2),
    "%p": d.getUTCHours() < 12 ? "AM" : "PM",
    "%b": MONTHS[d.getUTCMonth()],
  };
  return pattern.replace(/%[YmdHMSIpb]/g, (k) => map[k]);
}
const randomDate = (r, y0 = 2015, y1 = 2024) =>
  new Date(Date.UTC(intIn(r, y0, y1), intIn(r, 0, 11), intIn(r, 1, 28), intIn(r, 0, 23), intIn(r, 0, 59), intIn(r, 0, 59)));
const dateCol = (pattern) => (_i, r) => fmt(randomDate(r), pattern);

// ---------------------------------------------------------------- pools of fake personal data

const POOL = 4000;
const poolRng = mulberry32(SEED ^ 0x5bd1e995);

// Made-up syllables: none of these names, streets or words is in a real or faker word list.
const FIRST_A = ["Zan", "Quil", "Brax", "Vorn", "Kess", "Torv", "Malk", "Drev", "Nyx", "Pell", "Rux", "Sarv", "Tev", "Ulm", "Varq", "Wex", "Xan", "Yorl", "Zeph", "Quor"];
const FIRST_B = ["ade", "elle", "ira", "oma", "usk", "enn", "ova", "ilda", "ark", "yth"];
const LAST_A = ["Ardq", "Bexl", "Corv", "Dunq", "Elvx", "Fyrn", "Gorq", "Hevl", "Ixtr", "Jorv", "Kwel", "Lunq", "Morv", "Nexl", "Orvq", "Pyxl", "Qarn", "Rovl", "Sylq", "Tarx", "Uvrn", "Vexq", "Wyrl", "Xorv", "Yelq"];
const LAST_B = ["ston", "wick", "dale", "mere", "holt", "vane", "ridge", "lund", "brook", "field"];
const STREET_SUFFIX = ["Qrd", "Vxn", "Zlk", "Wyr", "Jnt"];
const firstName = (i) => FIRST_A[i % 20] + FIRST_B[Math.floor(i / 20) % 10];
const lastName = (i) => LAST_A[i % 25] + LAST_B[Math.floor(i / 25) % 10];
const WORDS = Array.from({ length: 800 }, (_, k) => `${FIRST_A[k % 20].toLowerCase()}${LAST_B[(k >> 2) % 10]}${k % 7}x`.replace(/[0-9]/g, (d) => "abcdefg"[d]));

const pools = {
  names: Array.from({ length: POOL }, (_, i) => `${firstName(i * 13)} ${lastName(i * 29 + 3)}`),
  streets: Array.from({ length: POOL }, (_, i) => `${100 + (i % 899)} ${lastName(i * 7 + 11)} ${STREET_SUFFIX[i % 5]}`),
  phones: Array.from({ length: POOL }, (_, i) => `(${["801", "385", "435"][i % 3]}) 555-${pad(i % 10000, 4)}`),
  intlPhones: Array.from({ length: POOL }, () => `+44 20 ${intIn(poolRng, 7000, 7999)} ${intIn(poolRng, 1000, 9999)}`),
  urls: Array.from({ length: POOL }, (_, i) => `https://www.${lastName(i * 3).toLowerCase()}.example.org/${firstName(i).toLowerCase()}`),
  words: WORDS,
};
const slug = (s) => s.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");

// ---------------------------------------------------------------- the zoo

/** Each entry: [name, generator(i, r) -> string, expected]. */
function buildZoo() {
  const Z = [];
  const add = (name, gen, expected) => Z.push({ name, gen, expected });
  const ok = (type, extra = {}) => ({ type, status: "ok", reasons: [], ...extra });
  const attention = (type, reasons, extra = {}) => ({ type, status: "needs_attention", reasons, ...extra });
  const unsupported = (extra = {}) => ({ type: "unsupported", status: "unsupported", reasons: ["unsupported_type"], ...extra });

  // Boolean
  add("bool_tf", (_i, r) => (r() < 0.4 ? "true" : "false"), ok("boolean"));
  add("bool_yn", withToken((_i, r) => (r() < 0.5 ? "Y" : "N"), 0.03, ""), ok("boolean", { na_tokens: [""] }));
  add("bool_yesno", (_i, r) => (r() < 0.5 ? "Yes" : "No"), ok("boolean"));
  add("bool_01", (_i, r) => (r() < 0.5 ? "0" : "1"), ok("boolean"));
  add("bool_one_value", () => "true", ok("categorical"));

  // Categorical
  const cat5 = ["North", "South", "East", "West", "Central"];
  add("cat_str_5", (_i, r) => pick(r, cat5), ok("categorical", { storage: "string" }));
  const l50 = Array.from({ length: 50 }, (_, k) => `Label_${pad(k + 1, 2)}`);
  add("cat_str_50", coverAll(l50), ok("categorical", { storage: "string" }));
  const l51 = Array.from({ length: 51 }, (_, k) => `Label_${pad(k + 1, 2)}`);
  add("cat_str_51", coverAll(l51), { type: "short_string", status: "ok", reasons: [], assert: ["type", "status"] });
  const codes = [1, 1, 1, 1, 2, 2, 2, 3, 3, 5, 8, 97];
  add("cat_int_codes", (_i, r) => String(pick(r, codes)), ok("categorical", { storage: "integer" }));
  const months = Array.from({ length: 12 }, (_, k) => pad(k + 1, 2));
  add("cat_int_zero_pad", (_i, r) => pick(r, months), ok("categorical", { storage: "string", notes: "leading zeros must survive" }));
  add("cat_int_sentinel", withToken((_i, r) => String(intIn(r, 1, 6)), 0.05, "-9"), attention("categorical", ["possible_sentinel"]));
  add("cat_rare", (i, r) => (i === 17 ? "RARE" : pick(r, ["A", "B", "C"])), ok("categorical", { notes: "RARE appears exactly once" }));
  add("cat_unicode", (_i, r) => pick(r, ["Café", "Zürich", "東京", "naïve", "Ångström"]), ok("categorical"));
  add("cat_special_chars", (_i, r) => pick(r, ["a,b", 'say "hi"', "line1\nline2", " lead", "trail ", "plain"]), ok("categorical", { notes: "quoting round trip" }));
  const i50 = Array.from({ length: 50 }, (_, k) => String(1000 + k));
  const i51 = Array.from({ length: 51 }, (_, k) => String(2000 + k));
  add("cat_int_50", coverAll(i50), attention("categorical", ["near_categorical_threshold"], { storage: "integer" }));
  add("cat_int_51", coverAll(i51), attention("integer", ["near_categorical_threshold"]));

  // Integer
  add("int_plain", (_i, r) => String(intIn(r, 0, 100000)), ok("integer"));
  add("int_negative", (_i, r) => String(intIn(r, -500, 500)), ok("integer"));
  add(
    "int_sentinels",
    (_i, r) => {
      const x = r();
      if (x < 0.02) return "-9";
      if (x < 0.04) return "-1";
      if (x < 0.05) return "998";
      if (x < 0.06) return "999";
      return String(intIn(r, 1, 600));
    },
    attention("integer", ["possible_sentinel"]),
  );
  add("int_thousands", (_i, r) => intIn(r, 1000, 99999).toLocaleString("en-US"), ok("integer", { notes: "thousands separator, quoted by minimal style", assert: ["type"] }));
  add("int_constant", () => "7", attention("categorical", [], { assert: ["type"] }));
  add("int_one_plus_na", (i) => (i === 3 ? "5" : ""), attention("categorical", [], { assert: ["type"], na_tokens: [""] }));
  add("int_skew_zero_inflated", (_i, r) => (r() < 0.6 ? "0" : String(Math.round(Math.exp(gauss(r) * 1.2 + 4)))), ok("integer"));
  add("int_big", (_i, r) => String(BigInt(Math.floor(r() * 2 ** 32)) * BigInt(2 ** 20) + BigInt(intIn(r, 0, 2 ** 20 - 1))), ok("integer", { assert: ["type"] }));

  // Float
  add("float_2dp", (_i, r) => (r() * 1000).toFixed(2), ok("float", { decimals: 2 }));
  add("float_6dp", (_i, r) => (r() * 10).toFixed(6), ok("float", { decimals: 6 }));
  add("float_trailing_zero", (_i, r) => (intIn(r, 1, 40) / 2).toFixed(2), ok("float", { decimals: 2, notes: "1.50 keeps its trailing zero" }));
  add("float_sci", (_i, r) => (r() * 1e-3).toExponential(1), ok("float", { assert: ["type"], notes: "scientific notation fidelity not yet decided" }));
  add("float_lognormal", (_i, r) => Math.exp(gauss(r) * 0.9 + 2).toFixed(3), ok("float"));
  add("float_bimodal", (_i, r) => ((r() < 0.5 ? 8 : 17) + gauss(r) * 1.2).toFixed(2), ok("float"));
  add("float_negative", (_i, r) => (r() * 101 - 50.5).toFixed(2), ok("float"));
  add("float_sd_zero", () => "3.14", ok("float", { assert: ["type"], notes: "beta fit fails at generation, falls back to uniform" }));
  add("float_with_sentinel", withToken((_i, r) => (r() * 100).toFixed(2), 0.05, "-9.99"), attention("float", ["possible_sentinel"]));

  // Date, datetime, time
  add("date_iso", dateCol("%Y-%m-%d"), ok("date", { format: "%Y-%m-%d" }));
  add("date_us", (_i, r) => fmt(randomDate(r), "%m/%d/%Y"), attention("date", ["date_format_ambiguous"], { assert: ["type"], notes: "days up to 28 so %m/%d/%Y and %d/%m/%Y both fit when the day is 12 or less; detection must pick the one that parses all values" }));
  add("date_eu", (_i, r) => fmt(randomDate(r), "%d/%m/%Y"), ok("date", { format: "%d/%m/%Y", assert: ["type"] }));
  add("date_text_month", dateCol("%d-%b-%Y"), ok("date", { format: "%d-%b-%Y" }));
  add("datetime_iso_t", (_i, r) => fmt(randomDate(r), "%Y-%m-%dT%H:%M:%S"), ok("datetime", { format: "%Y-%m-%dT%H:%M:%S" }));
  add("datetime_space", (_i, r) => fmt(randomDate(r), "%Y-%m-%d %H:%M:%S"), ok("datetime", { format: "%Y-%m-%d %H:%M:%S" }));
  add("datetime_12h", (_i, r) => fmt(randomDate(r), "%m/%d/%Y %I:%M:%S %p"), ok("datetime", { format: "%m/%d/%Y %I:%M:%S %p", assert: ["type"] }));
  add("time_hhmm_text", withToken((_i, r) => pad(intIn(r, 0, 23), 2) + pad(intIn(r, 0, 59), 2), 0.05, "-9"), attention("time", ["possible_sentinel"], { format: "%H%M" }));
  add("time_hh_mm", (_i, r) => `${pad(intIn(r, 0, 23), 2)}:${pad(intIn(r, 0, 59), 2)}`, ok("time", { format: "%H:%M" }));
  add("time_hh_mm_ss", (_i, r) => `${pad(intIn(r, 0, 23), 2)}:${pad(intIn(r, 0, 59), 2)}:${pad(intIn(r, 0, 59), 2)}`, ok("time", { format: "%H:%M:%S" }));
  add("date_ambiguous", (_i, r) => `${pad(intIn(r, 1, 12), 2)}/${pad(intIn(r, 1, 12), 2)}/${intIn(r, 2015, 2024)}`, attention("date", ["date_format_ambiguous"], { assert: ["status", "reasons"] }));
  add("date_mixed_formats", (i, r) => fmt(randomDate(r), i % 2 ? "%Y-%m-%d" : "%m/%d/%Y"), attention("unsupported", ["date_format_mixed"], { assert: ["status", "reasons"] }));
  add("date_with_offset", (_i, r) => fmt(randomDate(r), "%Y-%m-%dT%H:%M:%S") + "-07:00", unsupported({ assert: ["type", "status"] }));
  add("date_year_only", (_i, r) => String(intIn(r, 2000, 2024)), ok("categorical", { assert: ["type"], notes: "a year is not a date" }));
  add("date_bad_values", withToken(dateCol("%m/%d/%Y"), 0.02, "00/00/0000"), attention("date", ["date_format_unrecognized"], { assert: ["status"] }));

  // Survey IDs (names end in _id so the name rule fires; no value list may ever be stored)
  let gid = 0;
  let left = 0;
  const grouped = (make) => (_i, r) => {
    if (left === 0) {
      gid++;
      left = intIn(r, 1, 5);
    }
    left--;
    return make(gid);
  };
  const reset = () => {
    gid = 0;
    left = 0;
  };
  Z.resetters = [reset];
  add("hh_id", grouped((g) => String(10000 + ((g * 37) % 89999))), ok("survey_id", { mask: "[0-9]{5}" }));
  add("padded_id", grouped((g) => pad((g * 13) % 99999, 5)), ok("survey_id", { mask: "[0-9]{5}", notes: "zero padding kept" }));
  add("site_id", grouped((g) => `UT-${pad(100 + (g % 900), 3)}-${pad((g * 7) % 1000, 3)}`), ok("survey_id", { mask: "UT-[0-9]{3}-[0-9]{3}" }));
  add("hh_prefix_id", grouped((g) => `HH${1000000 + g * 3}`), ok("survey_id", { mask: "HH[0-9]{7}" }));
  add("row_id", (i) => String(500000 + i), ok("survey_id", { mask: "[0-9]{6}", notes: "unique per row" }));
  add("person_id", (i) => pad((i % 5) + 1, 2), ok("survey_id", { mask: "[0-9]{2}", notes: "sequence within a group" }));
  add("mixed_mask_id", (i, r) => (i % 2 ? `A${intIn(r, 100, 999)}` : String(intIn(r, 10000, 99999))), attention("survey_id", ["id_mixed_masks"], { assert: ["status"] }));
  add("few_distinct_hh_id", (_i, r) => String(7000 + intIn(r, 0, 39)), ok("survey_id", { assert: ["type"], notes: "40 distinct values, never categorical" }));

  // Personal identifiers, free text, short strings (no real value may leak)
  const personal = (kind, extra = {}) => ({ type: "personal", status: "ok", reasons: [], kind, ...extra });
  add("email", (i) => `${slug(pools.names[i % POOL])}.${i}@example.org`, personal("email"));
  add("phone_us", (i) => pools.phones[i % POOL], personal("phone"));
  add("phone_intl", (i) => pools.intlPhones[i % POOL], { type: "short_string", status: "ok", reasons: [], assert: ["type", "status"] });
  add("person_name", (i) => pools.names[i % POOL], personal("full_name"));
  add("first_name", (i) => firstName(i * 7), personal("first_name"));
  add("last_name", (i) => lastName(i * 11), personal("last_name"));
  add("street_address", (i) => pools.streets[(i * 7) % POOL], personal("address"));
  add("ssn_like", (_i, r) => `${intIn(r, 100, 899)}-${pad(intIn(r, 1, 99), 2)}-${pad(intIn(r, 1, 9999), 4)}`, unsupported({ reasons: ["unsupported_type", "possible_identifier", "ssn_needs_acknowledgement"], assert: ["type", "status"] }));
  add("free_text", (i, r) => `${pick(r, pools.words)}. ${pools.words[(i * 11) % pools.words.length]} ${pools.words[(i * 5) % pools.words.length]}, ref ${i}`, { type: "free_text", status: "ok", reasons: [], assert: ["type", "status"] });
  add("comments", (i, r) => Array.from({ length: intIn(r, 3, 40) }, (_, k) => pools.words[(i * 3 + k * 17) % pools.words.length]).join(" "), { type: "free_text", status: "ok", reasons: [], assert: ["type", "status"] });
  add("short_code_many", (_i, r) => `${String.fromCharCode(65 + intIn(r, 0, 25))}${String.fromCharCode(65 + intIn(r, 0, 25))}${pad(intIn(r, 0, 9999), 4)}`, { type: "short_string", status: "ok", reasons: [], assert: ["type", "status"] });
  add("plate", (_i, r) => `${String.fromCharCode(65 + intIn(r, 0, 25))}${String.fromCharCode(65 + intIn(r, 0, 25))}-${pad(intIn(r, 0, 9999), 4)}`, { type: "short_string", status: "ok", reasons: [], assert: ["type", "status"] });
  add("vendor_code", (_i, r) => `V${intIn(r, 10000, 99999)}${String.fromCharCode(97 + intIn(r, 0, 25))}`, { type: "short_string", status: "ok", reasons: [], assert: ["type", "status"] });
  add("email_mixed", (i, r) => (r() < 0.65 ? `${slug(pools.names[i % POOL])}.${i}@example.org` : `${pick(r, pools.words)} ${pick(r, pools.words)}`), { type: "personal", status: "needs_attention", reasons: ["kind_mixed"], kind: "email", assert: ["type", "status", "reasons"] });
  add("url", (i) => pools.urls[i % POOL], personal("url"));
  add("uuid", (i, r) => `${pad(intIn(r, 0, 0xffffff).toString(16), 8)}-${pad(intIn(r, 0, 0xffff).toString(16), 4)}-4${pad(intIn(r, 0, 0xfff).toString(16), 3)}-a${pad(intIn(r, 0, 0xfff).toString(16), 3)}-${pad((i * 2654435761 % 0xffffffffffff).toString(16), 12)}`, { type: "short_string", status: "ok", reasons: [], assert: ["type", "status"] });
  add("ip_address", (_i, r) => `${pick(r, ["198.51.100", "203.0.113", "192.0.2"])}.${intIn(r, 1, 254)}`, personal("ip"));

  // Unsupported in this version (coordinates and the like)
  add("lat", (_i, r) => (40.5 + r() * 0.6).toFixed(6), unsupported({ assert: ["type", "status"], notes: "coordinates" }));
  add("lon", (_i, r) => (-112.1 + r() * 0.5).toFixed(6), unsupported({ assert: ["type", "status"], notes: "coordinates" }));
  add("coord_pair", (_i, r) => `(${(40.5 + r() * 0.6).toFixed(6)}, ${(-112.1 + r() * 0.5).toFixed(6)})`, unsupported({ assert: ["type", "status"] }));
  add("wkt_point", (_i, r) => `POINT (${(-112.1 + r() * 0.5).toFixed(6)} ${(40.5 + r() * 0.6).toFixed(6)})`, unsupported({ assert: ["type", "status"] }));
  add("zip_text", (_i, r) => pad(intIn(r, 1000, 99999), 5), { type: "short_string", status: "ok", reasons: [], assert: ["type", "status"], notes: "leading zero must not be lost" });
  add("currency_text", (_i, r) => `$${intIn(r, 1, 9999).toLocaleString("en-US")}.${pad(intIn(r, 0, 99), 2)}`, { type: "short_string", status: "ok", reasons: [], assert: ["type", "status"] });
  add("percent_text", (_i, r) => `${intIn(r, 0, 100)}%`, { type: "short_string", status: "ok", reasons: [], assert: ["type", "status"] });

  // Empty, NA tokens
  add("all_na", () => "", ok("empty", { na_tokens: [""] }));
  add("mostly_na", (_i, r) => (r() < 0.99 ? "" : String(intIn(r, 1, 1000))), ok("categorical", { assert: ["type"], na_tokens: [""] }));
  add("na_blank", withToken((_i, r) => String(intIn(r, 0, 100000)), 0.05, ""), ok("integer", { na_tokens: [""] }));
  add("na_NA", withToken((_i, r) => String(intIn(r, 0, 100000)), 0.05, "NA"), ok("integer", { na_tokens: ["NA"] }));
  add("na_N_A", withToken((_i, r) => String(intIn(r, 0, 100000)), 0.05, "N/A"), ok("integer", { na_tokens: ["N/A"] }));
  add("na_NULL", withToken((_i, r) => String(intIn(r, 0, 100000)), 0.05, "NULL"), ok("integer", { na_tokens: ["NULL"] }));
  add("na_dot", withToken((_i, r) => String(intIn(r, 0, 100000)), 0.05, "."), ok("integer", { na_tokens: ["."] }));
  add(
    "na_mixed_tokens",
    (_i, r) => {
      const x = r();
      if (x < 0.02) return "";
      if (x < 0.04) return "NA";
      if (x < 0.06) return ".";
      return String(intIn(r, 0, 100000));
    },
    ok("integer", { na_tokens: ["", "NA", "."] }),
  );
  return Z;
}

// ---------------------------------------------------------------- CSV writing

function quoteField(v, delim, mode, forceQuote) {
  const needs = v.includes(delim) || v.includes('"') || v.includes("\n") || v.includes("\r") || v !== v.trim();
  if (mode === "all" || forceQuote || needs) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function formatRow(values, { delim = ",", eol = "\n", mode = "minimal", quotedCols = null } = {}) {
  const out = new Array(values.length);
  for (let c = 0; c < values.length; c++) {
    const v = values[c];
    out[c] = v === "" ? "" : quoteField(v, delim, mode, quotedCols ? quotedCols[c] : false);
  }
  return out.join(delim) + eol;
}

function writeText(path, text, encoding = "utf8") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(text, encoding));
}

function encodeUtf16(text, be, bom = true) {
  const le = Buffer.from(text, "utf16le");
  const body = be ? Buffer.from(le).swap16() : le;
  const mark = bom ? (be ? Buffer.from([0xfe, 0xff]) : Buffer.from([0xff, 0xfe])) : Buffer.alloc(0);
  return Buffer.concat([mark, body]);
}

// cp1252: the Latin-1 range plus the 0x80-0x9F block we use (Euro sign).
function encodeCp1252(text) {
  const bytes = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === 0x20ac) bytes.push(0x80);
    else if (cp < 256) bytes.push(cp);
    else bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}

function writeBuf(path, buf) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
}

// ---------------------------------------------------------------- outputs

function zooTable(n, { extraColumns = 0 } = {}) {
  const zoo = buildZoo();
  // Optional wide variant: repeat the first N simple columns with a suffix to reach ~120 columns.
  const cols = [...zoo];
  if (extraColumns > 0) {
    const base = zoo.filter((c) => !["email", "person_name", "first_name", "last_name", "street_address", "free_text", "comments", "email_mixed", "url", "phone_us", "phone_intl"].includes(c.name));
    for (let k = 0; k < extraColumns; k++) {
      const src = base[k % base.length];
      cols.push({ name: `${src.name}_r${Math.floor(k / base.length) + 1}`, gen: src.gen, expected: src.expected });
    }
  }
  const rngs = cols.map((c) => rngFor(c.name));
  return { cols, rngs, zoo };
}

function expectedJson(cols, n) {
  const columns = {};
  for (const c of cols) columns[c.name] = c.expected;
  return JSON.stringify({ generator: "scripts/make-fixtures.mjs", seed: SEED, n_rows: n, columns }, null, 2) + "\n";
}

function writeZooSmall(n = 2000) {
  const { cols, rngs, zoo } = zooTable(n);
  zoo.resetters?.forEach((f) => f());
  const lines = [formatRow(cols.map((c) => c.name))];
  for (let i = 0; i < n; i++) lines.push(formatRow(cols.map((c, k) => c.gen(i, rngs[k]))));
  writeText(join(ZOO_DIR, "zoo_small.csv"), lines.join(""));
  writeText(join(ZOO_DIR, "expected.json"), expectedJson(cols, n));
  console.log(`zoo_small.csv: ${n} rows, ${cols.length} columns`);
}

function writeIds50k() {
  const r = rngFor("ids_50k");
  const rows = [formatRow(["hh_id", "person_id", "trips"])];
  for (let h = 0; h < 50000; h++) {
    const id = String(10000 + h);
    const people = intIn(r, 1, 4);
    for (let p = 1; p <= people; p++) rows.push(formatRow([id, pad(p, 2), String(intIn(r, 0, 9))]));
  }
  writeText(join(ZOO_DIR, "ids_50k.csv"), rows.join(""));
  console.log(`ids_50k.csv: 50000 distinct hh_id values, ${rows.length - 1} rows`);
}

function writeText50k() {
  const r = rngFor("text_50k");
  const header = ["respondent_name", "email", "phone", "address", "plate"];
  const rows = [formatRow(header)];
  const N = 50000;
  const total = 60000; // 10,000 names appear twice, so repeats are exercised
  for (let k = 0; k < total; k++) {
    const i = k < N ? k : k - N; // the last 10,000 rows repeat the first 10,000 people
    const name = `${firstName(i % 200)} ${lastName(Math.floor(i / 200))}`;
    const na = r() < 0.03;
    const phoneArea = ["801", "385", "435", "970", "208", "307"][Math.floor(i / 10000) % 6];
    rows.push(
      formatRow([
        na ? (r() < 0.5 ? "" : "NA") : name,
        `${slug(name)}.${i}@example.org`,
        `(${phoneArea}) 555-${pad(i % 10000, 4)}`,
        `${10 + i} ${lastName(i * 3)} ${STREET_SUFFIX[i % 5]}`,
        `${String.fromCharCode(65 + intIn(r, 0, 25))}${String.fromCharCode(65 + intIn(r, 0, 25))}-${pad(intIn(r, 0, 9999), 4)}`,
      ]),
    );
  }
  writeText(join(ZOO_DIR, "text_50k.csv"), rows.join(""));
  console.log(`text_50k.csv: ${total} rows, 50000 distinct people`);
}

function writeVariants() {
  const r = rngFor("variants");
  const accents = ["Café", "Zürich", "naïve", "señor", "Straße", "€5"];
  const header = ["id", "label", "amount", "when", "flag", "note"];
  const rows = Array.from({ length: 200 }, (_, i) => [
    String(i + 1),
    pick(r, accents),
    (r() * 1000).toFixed(2),
    fmt(randomDate(r), "%Y-%m-%d"),
    r() < 0.5 ? "true" : "false",
    i % 25 === 0 ? 'has, comma and "quotes"' : i % 40 === 1 ? "two\nlines" : `note ${i}`,
  ]);
  const body = (opts) => [header, ...rows].map((row) => formatRow(row, opts)).join("");
  const dir = ZOO_DIR;
  const manifest = {};
  const note = (file, info) => (manifest[file] = info);

  writeText(join(dir, "variant_utf8.csv"), body({}));
  note("variant_utf8.csv", { encoding: "utf-8", bom: false, delimiter: ",", header: true });
  writeBuf(join(dir, "variant_utf8_bom.csv"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body({}), "utf8")]));
  note("variant_utf8_bom.csv", { encoding: "utf-8", bom: true, delimiter: ",", header: true });
  writeBuf(join(dir, "variant_utf16le.csv"), encodeUtf16(body({}), false));
  note("variant_utf16le.csv", { encoding: "utf-16le", bom: true, delimiter: ",", header: true });
  writeBuf(join(dir, "variant_utf16be.csv"), encodeUtf16(body({}), true));
  note("variant_utf16be.csv", { encoding: "utf-16be", bom: true, delimiter: ",", header: true });
  writeBuf(join(dir, "variant_cp1252.csv"), encodeCp1252(body({})));
  note("variant_cp1252.csv", { encoding: "windows-1252", bom: false, delimiter: ",", header: true, notes: "accents and the euro sign" });

  const decimalComma = (opts) =>
    [header, ...rows.map((row) => row.map((v, k) => (k === 2 ? v.replace(".", ",") : v)))].map((row) => formatRow(row, opts)).join("");
  writeText(join(dir, "delim_semicolon_decimal_comma.csv"), decimalComma({ delim: ";" }));
  note("delim_semicolon_decimal_comma.csv", { encoding: "utf-8", delimiter: ";", header: true, notes: "amount uses a decimal comma" });
  writeText(join(dir, "delim_tab.tsv"), body({ delim: "\t" }));
  note("delim_tab.tsv", { encoding: "utf-8", delimiter: "\t", header: true });
  writeText(join(dir, "delim_pipe.csv"), body({ delim: "|" }));
  note("delim_pipe.csv", { encoding: "utf-8", delimiter: "|", header: true });
  writeText(join(dir, "no_header.csv"), rows.map((row) => formatRow(row)).join(""));
  note("no_header.csv", { encoding: "utf-8", delimiter: ",", header: false });
  writeText(join(dir, "eol_crlf.csv"), body({ eol: "\r\n" }));
  note("eol_crlf.csv", { encoding: "utf-8", delimiter: ",", header: true, line_ending: "crlf" });
  writeText(join(dir, "eol_cr.csv"), body({ eol: "\r" }));
  note("eol_cr.csv", { encoding: "utf-8", delimiter: ",", header: true, line_ending: "cr" });
  writeText(join(dir, "quote_all.csv"), body({ mode: "all" }));
  note("quote_all.csv", { encoding: "utf-8", delimiter: ",", header: true, quote_style: "all" });
  // Strings quoted, numbers not (the pattern found in the NHTS file): id and amount are numeric.
  const quotedCols = [false, true, false, true, true, true];
  writeText(join(dir, "quote_percolumn.csv"), [header, ...rows].map((row, k) => formatRow(row, { mode: "minimal", quotedCols: k === 0 ? header.map(() => true) : quotedCols })).join(""));
  note("quote_percolumn.csv", { encoding: "utf-8", delimiter: ",", header: true, quote_style: "per_column", quoted: { id: false, label: true, amount: false, when: true, flag: true, note: true } });
  writeText(join(dir, "no_trailing_newline.csv"), body({}).replace(/\n$/, ""));
  note("no_trailing_newline.csv", { encoding: "utf-8", delimiter: ",", header: true, trailing_newline: false });

  // Files that should fail clearly or sit at a boundary.
  writeText(join(dir, "ragged.csv"), "a,b,c\n1,2,3\n4,5\n6,7,8,9\n");
  note("ragged.csv", { expect: "parse_error", notes: "message must not contain a cell value" });
  writeText(join(dir, "empty.csv"), "");
  note("empty.csv", { expect: "error_or_zero_columns" });
  writeText(join(dir, "header_only.csv"), "id,label,amount\n");
  note("header_only.csv", { expect: "zero_rows", columns: 3 });
  writeText(join(dir, "one_row.csv"), "id,label,amount\n1,Café,2.50\n");
  note("one_row.csv", { expect: "one_row", columns: 3 });
  writeText(join(dir, "dup_columns.csv"), "a,a,b\n1,2,3\n");
  note("dup_columns.csv", { expect: "duplicate_column_names" });
  writeText(join(dir, "blank_col_name.csv"), "a,,b\n1,2,3\n");
  note("blank_col_name.csv", { expect: "blank_column_name" });
  writeText(join(dir, "single_column.csv"), "only\n" + Array.from({ length: 50 }, (_, i) => String(i)).join("\n") + "\n");
  note("single_column.csv", { expect: "one_column", columns: 1 });
  const wideHeader = Array.from({ length: 500 }, (_, k) => `c${k + 1}`);
  writeText(join(dir, "wide_500.csv"), [wideHeader, ...Array.from({ length: 50 }, (_, i) => wideHeader.map((_, k) => String((i * 7 + k) % 90)))].map((row) => formatRow(row)).join(""));
  note("wide_500.csv", { expect: "profiles", columns: 500 });
  writeText(join(dir, "big_cell.csv"), `id,blob\n1,${"x".repeat(1024 * 1024)}\n2,short\n`);
  note("big_cell.csv", { expect: "no_freeze", notes: "one 1 MB cell" });

  writeText(join(dir, "variants.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`variants: ${Object.keys(manifest).length} files`);
}

async function writeLarge({ rows100k = false, targetBytes = 0 }) {
  const extra = targetBytes ? 35 : 0;
  const { cols, rngs, zoo } = zooTable(0, { extraColumns: extra });
  zoo.resetters?.forEach((f) => f());
  const name = rows100k ? "zoo_100k.csv" : "zoo_500mb.csv";
  mkdirSync(BIG_DIR, { recursive: true });
  const out = createWriteStream(join(BIG_DIR, name));
  const write = (s) => new Promise((res) => (out.write(s) ? res() : out.once("drain", res)));
  await write(formatRow(cols.map((c) => c.name)));
  let bytes = 0;
  let n = 0;
  const limitRows = rows100k ? 100000 : Infinity;
  while (n < limitRows && (rows100k || bytes < targetBytes)) {
    let chunk = "";
    for (let k = 0; k < 2000 && n < limitRows; k++, n++) chunk += formatRow(cols.map((c, j) => c.gen(n, rngs[j])));
    bytes += Buffer.byteLength(chunk);
    await write(chunk);
    if (n % 100000 === 0) console.log(`  ${n} rows, ${(bytes / 1e6).toFixed(0)} MB`);
  }
  await new Promise((res) => out.end(res));
  writeText(join(BIG_DIR, name.replace(".csv", ".expected.json")), expectedJson(cols, n));
  console.log(`${name}: ${n} rows, ${cols.length} columns, ${(bytes / 1e6).toFixed(0)} MB`);
}

const args = new Set(process.argv.slice(2));
if (args.has("--100k")) await writeLarge({ rows100k: true });
else if (args.has("--large")) await writeLarge({ targetBytes: 500 * 1024 * 1024 });
else {
  writeZooSmall();
  writeIds50k();
  writeText50k();
  writeVariants();
}
