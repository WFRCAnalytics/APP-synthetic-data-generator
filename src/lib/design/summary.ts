// One line that says what a designed column holds, for the list on the Design screen. Only what the person typed.

import type { DesignColumn } from "./types";

const pct = (n: number): string => `${Number(n.toFixed(1))}%`;

export function describeColumn(c: DesignColumn): string {
  switch (c.kind) {
    case "integer":
      return `${c.min} to ${c.max}, ${c.shape === "bell" ? `around ${c.typical}` : "even"}`;
    case "decimal":
      return `${c.min} to ${c.max}, ${c.decimals} ${c.decimals === 1 ? "decimal" : "decimals"}, ${c.shape === "bell" ? `around ${c.typical}` : "even"}`;
    case "category":
      return `${c.labels.length} ${c.labels.length === 1 ? "label" : "labels"}`;
    case "yesno":
      return `${c.yesLabel} ${pct(c.yesPct)}, ${c.noLabel} ${pct(100 - c.yesPct)}`;
    case "date":
    case "datetime":
      return `${c.start} to ${c.end}`;
    case "id":
      return c.link ? `the IDs of ${c.link.column} in ${c.link.table ?? "another table"}, ${c.perIdMin} to ${c.perIdMax} rows each` : `${c.prefix}${"9".repeat(Math.max(0, Math.min(c.digits, 12)))}`;
    case "personal":
      return c.personal.replace("_", " ");
    case "text":
      return `${c.minLength} to ${c.maxLength} characters`;
  }
}
