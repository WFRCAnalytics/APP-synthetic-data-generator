// Parses a real CSV and its fake twin with the same code and compares what a parser would see:
// column names and order, row count, each column's inferred type, NA markers, and the file's
// dialect (success criterion SC-004). Run it after generating, before handing the fake file to an
// agent:
//
//   npm run verify:roundtrip -- path/to/real.csv path/to/real_fake.csv
//
// Exit code 0 means the fake file reads the same way; 1 means a difference was found. Columns the
// app leaves out (personal data, free text) are reported, not treated as failures.

import { readFileSync } from "node:fs";

function decode(buffer) {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return { text: buffer.subarray(3).toString("utf8"), encoding: "utf-8", bom: true };
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return { text: buffer.subarray(2).toString("utf16le"), encoding: "utf-16le", bom: true };
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return { text: Buffer.from(buffer.subarray(2)).swap16().toString("utf16le"), encoding: "utf-16be", bom: true };
  const text = buffer.toString("utf8");
  return { text, encoding: text.includes("�") ? "windows-1252" : "utf-8", bom: false };
}

function sniff(text) {
  const counts = new Map();
  for (const d of [",", ";", "\t", "|"]) {
    const first = text.split(/\r\n|\n|\r/)[0] ?? "";
    counts.set(d, first.split(d).length);
  }
  const delimiter = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  const cr = (text.match(/\r(?!\n)/g) ?? []).length;
  const lineEnding = crlf >= lf && crlf >= cr && crlf > 0 ? "crlf" : cr > lf ? "cr" : "lf";
  return { delimiter, lineEnding, trailingNewline: /[\r\n]$/.test(text) };
}

function parse(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const NA = new Set(["", "NA", "N/A", "n/a", "NULL", "null", "NaN", "nan", ".", "#N/A", "None", "none"]);

// One simple, shared rule for "what type does a parser see in this column".
function inferType(values) {
  const present = values.filter((v) => !NA.has(v));
  if (present.length === 0) return "empty";
  if (present.every((v) => /^-?\d+$/.test(v))) return "integer";
  if (present.every((v) => /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v))) return "number";
  if (present.every((v) => /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/.test(v) || /^\d{1,2}\/\d{1,2}\/\d{4}/.test(v))) return "date";
  return "text";
}

function load(path) {
  const { text, encoding, bom } = decode(readFileSync(path));
  const dialect = { encoding, bom, ...sniff(text) };
  const rows = parse(text, dialect.delimiter);
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const columns = header.map((name, c) => {
    const values = body.map((r) => r[c] ?? "");
    return { name, type: inferType(values), na: [...new Set(values.filter((v) => NA.has(v)))].sort() };
  });
  return { dialect, header, rowCount: body.length, columns };
}

const [realPath, fakePath] = process.argv.slice(2);
if (!realPath || !fakePath) {
  console.error("usage: npm run verify:roundtrip -- <real.csv> <fake.csv>");
  process.exit(2);
}

const real = load(realPath);
const fake = load(fakePath);
const problems = [];
const notes = [];

for (const key of ["encoding", "bom", "delimiter", "lineEnding", "trailingNewline"]) {
  if (real.dialect[key] !== fake.dialect[key]) problems.push(`${key}: real ${JSON.stringify(real.dialect[key])}, fake ${JSON.stringify(fake.dialect[key])}`);
}
if (real.rowCount !== fake.rowCount) problems.push(`row count: real ${real.rowCount}, fake ${fake.rowCount}`);

const realByName = new Map(real.columns.map((c) => [c.name, c]));
const left = real.columns.filter((c) => !fake.header.includes(c.name)).map((c) => c.name);
if (left.length > 0) notes.push(`${left.length} column(s) in the real file are not in the fake file (left out by the app): ${left.join(", ")}`);

const expectedOrder = real.header.filter((n) => fake.header.includes(n));
if (JSON.stringify(expectedOrder) !== JSON.stringify(fake.header)) problems.push("column order differs from the real file");

for (const col of fake.columns) {
  const original = realByName.get(col.name);
  if (!original) {
    problems.push(`column "${col.name}" is in the fake file but not the real one`);
    continue;
  }
  if (original.type !== col.type) problems.push(`column "${col.name}": real parses as ${original.type}, fake as ${col.type}`);
  if (JSON.stringify(original.na) !== JSON.stringify(col.na)) problems.push(`column "${col.name}": missing-value markers differ (real ${JSON.stringify(original.na)}, fake ${JSON.stringify(col.na)})`);
}

for (const n of notes) console.log(`note: ${n}`);
if (problems.length === 0) {
  console.log(`OK: ${fake.columns.length} columns and ${fake.rowCount} rows read the same way in both files.`);
  process.exit(0);
}
console.log(`${problems.length} difference(s):`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(1);
