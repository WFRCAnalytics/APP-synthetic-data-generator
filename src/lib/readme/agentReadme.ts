// The README that travels with a fake file (specs/011): a plain Markdown page that tells a coding agent, or a person,
// what the file is, how it is laid out, what each column holds and what it must not be used for. It is built from the
// spec alone, so it says nothing the spec does not already hold (category labels, exact limits, counts and formats), and
// never a row of the real file. Pure code, tested in Node.

import { AXIS_LABELS } from "../classify/coordinate";
import { EMPTY_TEXT_TOKEN, type ColumnSpec, type SpecFile } from "../spec/types";

export interface AgentReadmeOptions {
  /** The name of the fake file as it is downloaded. */
  fakeFileName: string;
  /** The name of the saved spec, if one goes with it. */
  specFileName?: string;
  /** The seed the file was made with. */
  seed: number;
  /** The app's version, such as 0.4.0. */
  appVersion: string;
}

const MAX_LABELS_SHOWN = 12;

const n = (value: number): string => value.toLocaleString("en-US");
const num = (value: number): string =>
  Number.isInteger(value) ? n(value) : String(Number(value.toPrecision(6)));
const tick = (text: string): string => `\`${text.replace(/`/g, "'")}\``;
/** Text inside a table cell: no pipes, no line breaks. */
const cell = (text: string): string => text.replace(/\|/g, "/").replace(/\r?\n/g, " ");

const FORMAT_NAMES: Record<SpecFile["source"]["format"], string> = {
  csv: "CSV",
  xlsx: "Excel workbook (.xlsx)",
  parquet: "Parquet",
  json: "JSON",
};

/** What a column's values are, in a few words. */
function kindOf(c: ColumnSpec): string {
  switch (c.type) {
    case "integer":
      return "whole number";
    case "float":
      return "decimal number";
    case "categorical":
      return c.storage === "integer" ? "coded category (whole numbers)" : "category";
    case "boolean":
      return "yes or no";
    case "date":
      return "date";
    case "datetime":
      return "date and time";
    case "time":
      return "time of day";
    case "survey_id":
      return "ID";
    case "personal":
      return `invented ${c.kind.replace("_", " ")}`;
    case "free_text":
      return "free text";
    case "short_string":
      return "short code";
    case "empty":
      return "always missing";
    case "unsupported":
      return "not supported";
  }
}

const maskText = (mask: readonly (string | { literal: string })[]): string =>
  mask
    .map((t) =>
      typeof t === "string"
        ? ({ digit: "9", upper: "A", lower: "a", letter: "L", alnum: "X" }[t] ?? "?")
        : t.literal,
    )
    .join("");

/** What a column holds, from the spec's own numbers and labels. */
function describe(c: ColumnSpec): string {
  const text = describeValues(c);
  // Codes kept apart from the numbers (such as -9 for refused) read better with what they mean.
  const codes = Object.keys(c.sentinels ?? {}).map(
    (k) => `${tick(k)}${c.value_labels?.[k] ? ` (${c.value_labels[k]})` : ""}`,
  );
  return codes.length > 0 ? `${text}; codes: ${codes.join(", ")}` : text;
}

function describeValues(c: ColumnSpec): string {
  switch (c.type) {
    case "integer":
    case "float":
      if (c.coordinate)
        return `${AXIS_LABELS[c.coordinate].toLowerCase()} inside the box ${num(c.min)} to ${num(c.max)}, ${c.decimals ?? 0} decimal places, spread evenly`;
      return `${num(c.min)} to ${num(c.max)}${c.type === "float" ? `, ${c.decimals ?? 0} decimal places` : ""}`;
    case "date":
    case "datetime":
    case "time":
      return `format ${tick(c.format)}`;
    case "categorical":
    case "boolean": {
      const labels = Object.keys(c.counts);
      const shown = labels
        .slice(0, MAX_LABELS_SHOWN)
        .map(
          (l) =>
            (l === "" ? "(blank)" : tick(l)) +
            (c.value_labels?.[l] ? ` (${c.value_labels[l]})` : ""),
        );
      return `${labels.length} ${labels.length === 1 ? "value" : "values"}: ${shown.join(", ")}${labels.length > MAX_LABELS_SHOWN ? ", ..." : ""}`;
    }
    case "survey_id":
      return c.mask.length > 0
        ? `pattern ${tick(maskText(c.mask))} (9 digit, A upper case, a lower case)`
        : "unique codes";
    case "personal":
      return "invented, never copied";
    case "free_text":
      return `${n(c.min)} to ${n(c.max)} characters`;
    case "short_string":
      return `pattern ${tick(maskText(c.pattern))}`;
    default:
      return "";
  }
}

const missingText = (c: ColumnSpec, rows: number): string => {
  const count = c.na?.count ?? 0;
  if (count === 0) return "none";
  const tokens = (c.na?.tokens ?? [""]).map((t) =>
    t === "" ? "an empty field" : t === EMPTY_TEXT_TOKEN ? "empty text" : tick(t),
  );
  return `${n(count)} (${Number(((count / Math.max(1, rows)) * 100).toFixed(1))}%) as ${tokens.join(" or ")}`;
};

function layoutLines(spec: SpecFile): string[] {
  const s = spec.source;
  switch (s.format) {
    case "csv":
      return [
        `Delimiter ${tick(s.delimiter === "\t" ? "tab" : s.delimiter)}, quote ${tick(s.quote ?? "none")}, ${s.header ? "with a header row" : "no header row"}, ${s.encoding}${s.bom ? " with a byte-order mark" : ""}, ${(s.line_ending ?? "lf").toUpperCase()} line endings.`,
      ];
    case "xlsx":
      return [
        `One sheet named ${tick(s.sheet)}; ${s.skip_rows > 0 ? `${s.skip_rows} empty rows above the header; ` : ""}${s.header ? "the first row of the table is the header" : "no header row"}.`,
      ];
    case "parquet":
      return [
        "Column types (integer widths, decimals, dates, timestamps) are the real file's, so a reader sees the same schema.",
      ];
    case "json":
      return [
        s.form === "array"
          ? `A list of records${s.indent === "compact" ? " on one line" : `, indented by ${s.indent === "tab" ? "a tab" : `${s.indent} spaces`}`}.`
          : "One JSON record per line.",
      ];
  }
}

export function agentReadme(spec: SpecFile, options: AgentReadmeOptions): string {
  const rows = spec.n_rows;
  const written = spec.columns.filter(
    (c) => (c.exclude ?? "include") !== "drop" && c.type !== "unsupported",
  );
  const out: string[] = [];
  const add = (...lines: string[]) => out.push(...lines);

  add(`# ${options.fakeFileName}: synthetic data`, "");
  add(
    "**This data is not real.** Every value was invented by the WFRC Synthetic Data Generator from a description of a table (counts, limits, formats). No row of a real table is in it. Treat it as a stand-in: write and test code against it, never draw conclusions from it.",
    "",
  );

  add("## The file", "");
  add(`- **Name**: ${tick(options.fakeFileName)}`);
  add(`- **Type**: ${FORMAT_NAMES[spec.source.format]}`);
  add(`- **Rows**: ${n(rows)}`);
  add(`- **Columns**: ${written.length}`);
  add(
    `- **Made with**: Synthetic Data Generator ${options.appVersion}, seed ${options.seed}. The same description and seed give the same file.`,
  );
  if (options.specFileName)
    add(
      `- **Description of the table**: ${tick(options.specFileName)} (a small JSON file that holds only counts, limits, labels and formats).`,
    );
  for (const line of layoutLines(spec)) add(`- **Layout**: ${line}`);
  add("");

  add("## The columns", "");
  add("| Column | Kind | Holds | Missing |", "| --- | --- | --- | --- |");
  for (const c of written)
    add(
      `| ${tick(c.output_name ?? c.name)} | ${kindOf(c)} | ${cell(describe(c))} | ${cell(missingText(c, rows))} |`,
    );
  add("");
  const left = spec.columns.length - written.length;
  if (left > 0)
    add(
      `${left} ${left === 1 ? "column of the real table is" : "columns of the real table are"} not in this file.`,
      "",
    );

  add("## How to use it", "");
  add(
    "- Write and run your code against this file. Names, order, types, missing-value markers and layout match the real file, so the same code should run unchanged on the real one.",
  );
  add(
    "- Missing values are written as the real file wrote them. Check for them before you convert a column.",
  );
  add(
    "- Do not look for real people or places in it: names, emails, phone numbers and addresses are invented, and ID values are made up to follow the same pattern.",
  );
  add(
    "- Do not fit models for findings on it: it keeps each column's counts and ranges, not the relations between columns.",
  );
  add(
    "- Category labels, limits and counts come from the real table's summary, so share this file only where that summary may be shared.",
  );
  add(
    "- If something looks wrong, change the description of the table and make the file again; do not edit the values by hand.",
  );
  add("");
  return out.join("\n");
}

/** "trips_fake.csv" becomes "trips_fake_README.md". */
export function readmeFileNameFor(fakeFileName: string): string {
  const base = fakeFileName.replace(/\.[^.]*$/, "") || "table";
  return `${base}_README.md`;
}
