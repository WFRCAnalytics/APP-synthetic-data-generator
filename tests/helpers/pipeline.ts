// The whole slice-1 pipeline in Node: open a file, load it, profile it, build the spec, and render a
// fake file from that spec. Used by the round-trip and corpus tests.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { renderAll } from "../../src/lib/generate/render";
import { planTable } from "../../src/lib/generate/table";
import type { ColumnProfile, FileSettings } from "../../src/lib/profile/types";
import { buildSpec } from "../../src/lib/spec/build";
import type { SpecFile } from "../../src/lib/spec/types";
import { columnNamesFor, detectFileSettings, HEAD_BYTES, TAIL_BYTES, detectQuotedColumns } from "../../src/workers/profile/open";
import { loadCsv } from "../../src/workers/profile/load";
import { readModeFor, transcodeToUtf8 } from "../../src/workers/profile/transcode";
import { profileAll } from "../../src/workers/profile/profiler";
import type { NodeDb } from "./duckdbNode";
import { openFromDisk } from "./duckdbNode";

export interface Profiled {
  settings: FileSettings;
  columnNames: string[];
  rowCount: number;
  profiles: ColumnProfile[];
  spec: SpecFile;
}

let counter = 0;

type Enc = FileSettings["encoding"];

/** Registers a file the way the profile worker does: read natively, or transcoded to UTF-8 first. */
async function register(db: NodeDb, name: string, path: string, encoding: Enc): Promise<"utf-8" | "utf-16"> {
  const mode = readModeFor(encoding);
  if (mode.kind === "native") {
    db.registerPath(name, path);
    return mode.encoding;
  }
  db.registerBuffer(name, await transcodeToUtf8(new Blob([new Uint8Array(readFileSync(path))]), encoding));
  return "utf-8";
}

async function registerBytes(db: NodeDb, name: string, bytes: Uint8Array, encoding: Enc): Promise<"utf-8" | "utf-16"> {
  const mode = readModeFor(encoding);
  if (mode.kind === "native") {
    db.registerBuffer(name, bytes);
    return mode.encoding;
  }
  db.registerBuffer(name, await transcodeToUtf8(new Blob([new Uint8Array(bytes)]), encoding));
  return "utf-8";
}

/** Loads and profiles a file on disk, then builds its spec. */
export async function profilePath(db: NodeDb, path: string, seed = 42): Promise<Profiled> {
  const opened = openFromDisk(path);
  const name = `f${counter++}_${basename(path)}`;
  const readEncoding = await register(db, name, path, opened.settings.encoding);
  const loaded = await loadCsv(db.sql, name, opened.settings, opened.columnNames, readEncoding);
  const profiles = await profileAll(db.sql, loaded.columnNames, loaded.rowCount, { threshold: 50, quoted: opened.quoted });
  const spec = buildSpec({
    fileName: basename(path),
    settings: opened.settings,
    rowCount: loaded.rowCount,
    seed,
    keepOriginalName: false,
    threshold: 50,
    profiles,
  });
  return { settings: opened.settings, columnNames: loaded.columnNames, rowCount: loaded.rowCount, profiles, spec };
}

/** Renders the fake file for a spec. */
export function renderSpec(spec: SpecFile, seed?: number): Uint8Array {
  return renderAll(planTable(spec, seed ?? spec.seed));
}

/** Loads and profiles bytes already in memory (a generated file), as if it were a new input. */
export async function profileBytes(db: NodeDb, bytes: Uint8Array, label: string, forceHeader?: boolean): Promise<Profiled> {
  const head = bytes.subarray(0, HEAD_BYTES);
  const tail = bytes.subarray(Math.max(0, bytes.length - TAIL_BYTES));
  const opened = detectFileSettings(head, tail, bytes.length);
  // A headerless file can look like it has a header (a data row of text); callers that know better say so.
  if (forceHeader !== undefined && forceHeader !== opened.settings.header) {
    opened.settings = { ...opened.settings, header: forceHeader };
    opened.columnNames = columnNamesFor(head, opened.settings, bytes.length);
  }
  const quoted = detectQuotedColumns(head, bytes.length);
  const name = `g${counter++}_${label}`;
  const readEncoding = await registerBytes(db, name, bytes, opened.settings.encoding);
  const loaded = await loadCsv(db.sql, name, opened.settings, opened.columnNames, readEncoding);
  const profiles = await profileAll(db.sql, loaded.columnNames, loaded.rowCount, { threshold: 50, quoted });
  const spec = buildSpec({ fileName: label, settings: opened.settings, rowCount: loaded.rowCount, seed: 42, keepOriginalName: false, threshold: 50, profiles });
  return { settings: opened.settings, columnNames: loaded.columnNames, rowCount: loaded.rowCount, profiles, spec };
}

export const readText = (path: string) => readFileSync(path, "utf8");
