// Sharing the rows of a table out among IDs (specs/027).

/**
 * How many IDs have each number of rows, when every ID has between `min` and `max` rows and the rows add up. The sizes are spread
 * evenly across the range. Null when the rows cannot be shared out that way (7 rows with 5 or 6 per ID, say).
 */
export function repeatForRange(rows: number, min: number, max: number): Record<string, number> | null {
  if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) return null;
  const fewest = Math.ceil(rows / max);
  const most = Math.floor(rows / min);
  if (fewest > most) return null;
  const groups = Math.min(most, Math.max(fewest, Math.round(rows / ((min + max) / 2))));
  const spread = max - min + 1;
  const sizes = Array.from({ length: groups }, (_, i) => min + (i % spread));
  let diff = rows - sizes.reduce((a, b) => a + b, 0);
  for (let i = 0; diff !== 0; i = (i + 1) % groups) {
    if (diff > 0 && sizes[i] < max) {
      sizes[i]++;
      diff--;
    } else if (diff < 0 && sizes[i] > min) {
      sizes[i]--;
      diff++;
    }
  }
  const out: Record<string, number> = {};
  for (const size of sizes) out[size] = (out[size] ?? 0) + 1;
  return out;
}
