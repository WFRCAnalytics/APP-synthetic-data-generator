// Downloads other people's CSV test files into .fixtures/corpus/ (git-ignored, never committed) so
// the robustness test can run them through the pipeline (fixture-matrix.md, section 5):
//
//   node scripts/fetch-corpus.mjs            DuckDB's CSV edge cases and csv-spectrum (small)
//   node scripts/fetch-corpus.mjs --public   also the NHTS 2017 trip file and a Chicago Crimes slice (large)
//
// Files come from fixed tags or well-known URLs. They carry no expected types, so tests on them only
// assert "no crash, no leaked value, round trip where the file parses".

import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, ".fixtures", "corpus");
const DUCKDB_TAG = "v1.5.4"; // the engine inside the pinned @duckdb/duckdb-wasm
const DUCKDB_RAW = `https://raw.githubusercontent.com/duckdb/duckdb/${DUCKDB_TAG}/data/csv`;
const SPECTRUM_RAW = "https://raw.githubusercontent.com/max-mapper/csv-spectrum/master/csvs";

// A hand-picked selection (MIT licensed): dates and timestamps, decimals, leading zeros, quoting and
// newlines, encodings, NUL bytes, ragged and empty files.
const DUCKDB_FILES = [
  "bool.csv", "bad_date.csv", "bad_date_2.csv", "bad_date_timestamp_mix.csv", "borked_date.csv", "custom_date.csv",
  "date_specificity.csv", "dates.csv", "dates_special_format.csv", "special_date.csv", "mixed_dates.csv", "mixed_timestamps.csv",
  "decimal.csv", "comma_decimal_null.csv", "mixed_decimal.csv", "mixed_double.csv", "integer_exponent.csv", "big_number.csv",
  "leading_zeros.csv", "leading_zeros2.csv", "quoted_newline.csv", "csv_quoted_newline_odd.csv", "single_quote.csv", "multi_quote.csv",
  "all_quotes.csv", "double_quoted_header.csv", "blank_line.csv", "empty.csv", "empty_first_line.csv", "header_only.csv", "header_only_2.csv",
  "nullpadding.csv", "null_string.csv", "nullbyte.csv", "mixed_new_line.csv", "mixed_new_line_2.csv", "one_n_two.csv",
  "one_r_two.csv", "one_r_n_two.csv", "extra_delimiters.csv", "pipe_delim.csv", "missing_column.csv", "small_bad.csv", "invalid_utf8.csv",
  "people.csv", "phonenumbers.csv", "customer.csv", "flights.csv", "small_file.csv", "sales_snippet.csv", "soccer_kaggle.csv", "repromarket.csv",
  "response.csv", "manycolumns.csv", "evil_nullpadding.csv", "empty_space_start_value.csv",
  "encodings/all_latin1.csv", "encodings/all_utf16.csv", "encodings/latin1.csv", "encodings/only_latin1.csv", "encodings/only_utf16.csv",
  "encodings/shift_jis.csv", "encodings/utf16.csv",
];
const SPECTRUM_FILES = [
  "comma_in_quotes", "empty", "empty_crlf", "escaped_quotes", "json", "location_coordinates", "newlines", "newlines_crlf",
  "quotes_and_newlines", "simple", "simple_crlf", "utf8",
].map((n) => `${n}.csv`);

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok || !res.body) return false;
  mkdirSync(dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  return true;
}

async function group(label, base, names, dir) {
  let ok = 0;
  for (const name of names) {
    const dest = join(OUT, dir, name);
    if (existsSync(dest) || (await download(`${base}/${name}`, dest))) ok++;
    else console.warn(`  missing: ${label}/${name}`);
  }
  console.log(`${label}: ${ok} of ${names.length} files`);
}

await group("duckdb", DUCKDB_RAW, DUCKDB_FILES, "duckdb");
await group("csv-spectrum", SPECTRUM_RAW, SPECTRUM_FILES, "spectrum");

if (process.argv.includes("--public")) {
  const dir = join(OUT, "public");
  mkdirSync(dir, { recursive: true });

  const trips = join(dir, "nhts2017_trippub.csv");
  if (!existsSync(trips)) {
    console.log("NHTS 2017: downloading the zip (84 MB)...");
    const zip = join(dir, "nhts2017.zip");
    if (await download("https://nhts.ornl.gov/assets/2016/download/csv.zip", zip)) {
      // tar reads zip archives on Windows, macOS and Linux.
      const result = spawnSync("tar", ["-xf", zip, "-C", dir, "trippub.csv"], { stdio: "inherit" });
      if (result.status === 0) spawnSync(process.execPath, ["-e", `require("fs").renameSync(${JSON.stringify(join(dir, "trippub.csv"))}, ${JSON.stringify(trips)})`]);
      rmSync(zip, { force: true });
    }
  }

  const crimes = join(dir, "chicago_crimes_1m.csv");
  if (!existsSync(crimes)) {
    console.log("Chicago Crimes: downloading 1,000,000 rows...");
    await download("https://data.cityofchicago.org/resource/ijzp-q8t2.csv?$limit=1000000", crimes);
  }
  console.log("public: done");
}
