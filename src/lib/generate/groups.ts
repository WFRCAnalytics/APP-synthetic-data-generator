// Turns a repeat structure into a map from a row's rank (among a column's real values) to the number
// of its group of identical values (specs/002 research R2, slice 1 research R5). A repeat structure
// says how many distinct values appear once, twice, three times; the rows are laid out size by size,
// so exactly that many groups of each size exist. The result is a pure function of the row.

export interface GroupMapper {
  /** Group number (0 to groups - 1) for a row rank (0 to rows - 1). */
  (valueIndex: number): number;
  /** Distinct values the column uses. */
  groups: number;
  /** Rows the repeat structure covers. */
  rows: number;
}

export function makeGroupMapper(repeatStructure: Record<string, number>): GroupMapper {
  const buckets = Object.entries(repeatStructure)
    .map(([size, count]) => ({ size: Number(size), count }))
    .filter((b) => b.size > 0 && b.count > 0)
    .sort((a, b) => a.size - b.size);

  // Where each size's block of rows and block of groups starts.
  const rowStart: number[] = [];
  const groupStart: number[] = [];
  let rows = 0;
  let groups = 0;
  for (const b of buckets) {
    rowStart.push(rows);
    groupStart.push(groups);
    rows += b.size * b.count;
    groups += b.count;
  }

  const mapper = ((valueIndex: number): number => {
    let lo = 0;
    let hi = buckets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rowStart[mid] <= valueIndex) lo = mid;
      else hi = mid - 1;
    }
    return groupStart[lo] + Math.floor((valueIndex - rowStart[lo]) / buckets[lo].size);
  }) as GroupMapper;
  mapper.groups = groups;
  mapper.rows = rows;
  return mapper;
}
