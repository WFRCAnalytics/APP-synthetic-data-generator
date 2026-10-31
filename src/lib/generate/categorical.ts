// Categorical and boolean columns (FR-023): the exact label counts, shuffled across rows. A row's
// rank among the real values picks its label from the cumulative counts, so the multiset of labels
// is exact without storing a shuffled array.

/** Returns a lookup from a value rank in [0, total) to a label. */
export function makeLabelLookup(counts: Record<string, number>): { total: number; at: (index: number) => string } {
  const labels: string[] = [];
  const ends: number[] = [];
  let total = 0;
  for (const [label, n] of Object.entries(counts)) {
    if (n <= 0) continue;
    total += n;
    labels.push(label);
    ends.push(total);
  }

  return {
    total,
    at(index: number): string {
      // First label whose cumulative end is above the index.
      let lo = 0;
      let hi = ends.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ends[mid] > index) hi = mid;
        else lo = mid + 1;
      }
      return labels[lo] ?? "";
    },
  };
}
