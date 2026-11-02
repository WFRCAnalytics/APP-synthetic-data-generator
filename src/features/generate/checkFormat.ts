// How a check's target and achieved values read in the check table. The checks hold exact summaries as text, some of them
// small JSON objects (a count per label, a repeat structure); in the table those read as "bus: 80, car: 200" instead.
// The full text stays in the cell's title.

const MAX_PAIRS = 4;

export function formatCheckValue(text: string): string {
  const t = text.trim();
  if (!(t.startsWith("{") && t.endsWith("}"))) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    return text;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return text;
  const entries = Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === "number" || typeof v === "string");
  if (entries.length === 0) return text;
  const shown = entries.slice(0, MAX_PAIRS).map(([k, v]) => `${k === "" ? "(blank)" : k}: ${typeof v === "number" ? v.toLocaleString("en-US") : v}`);
  return entries.length > MAX_PAIRS ? `${shown.join(", ")} and ${entries.length - MAX_PAIRS} more` : shown.join(", ");
}
