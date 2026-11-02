// A finished CSV run written as an SPSS, Stata or SAS transport file (specs/018, 025). Used by the Generate screen and by the
// batch of tables; it works from the CSV text and the spec only.

import type { SpecFile } from "../spec/types";
import { writeDta, DTA_MAX_TEXT } from "./dta";
import type { ConvertKind } from "./detect";
import { writeSav, SAV_MAX_TEXT } from "./sav";
import { tableFromCsv, type ColumnMeta } from "./table";
import { writeXpt, XPT_MAX_TEXT } from "./xpt";

export function statFileFromCsv(csv: string, spec: SpecFile | null, format: ConvertKind): { bytes: Uint8Array; truncated: number } {
  const hints: Record<string, string> = {};
  const meta: Record<string, ColumnMeta> = {};
  for (const c of spec?.columns ?? []) {
    hints[c.output_name ?? c.name] = c.type;
    meta[c.output_name ?? c.name] = { description: c.description, valueLabels: c.value_labels };
  }
  const table = tableFromCsv(csv, hints, format === "sav" ? SAV_MAX_TEXT : format === "dta" ? DTA_MAX_TEXT : XPT_MAX_TEXT, meta);
  const bytes = format === "sav" ? writeSav(table) : format === "dta" ? writeDta(table) : writeXpt(table);
  return { bytes, truncated: table.truncated };
}
