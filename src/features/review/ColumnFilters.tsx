// Search and filters for the column list (FR-010): by name, to columns that need a look, and by type.

import { useId } from "react";
import { typeLabel } from "./summary";
import { isFiltering, NO_FILTERS, type Filters } from "./filter";

export interface ColumnFiltersProps {
  filters: Filters;
  onChange: (filters: Filters) => void;
  /** How many columns have each type, for the type menu. */
  typeCounts: Record<string, number>;
  total: number;
  shown: number;
}

export function ColumnFilters({ filters, onChange, typeCounts, total, shown }: ColumnFiltersProps) {
  const id = useId();
  const types = Object.keys(typeCounts).sort();

  return (
    <div className="column-filters" role="search" aria-label="Filter columns">
      <div className="field">
        <label htmlFor={`${id}-search`}>Search columns</label>
        <input id={`${id}-search`} type="search" placeholder="Column name" value={filters.query} onChange={(e) => onChange({ ...filters, query: e.target.value })} />
      </div>

      <div className="field">
        <label htmlFor={`${id}-type`}>Type</label>
        <select id={`${id}-type`} value={filters.type} onChange={(e) => onChange({ ...filters, type: e.target.value })}>
          <option value="all">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {typeLabel(t)} ({typeCounts[t]})
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${id}-attention`}>
          <input id={`${id}-attention`} type="checkbox" checked={filters.attentionOnly} onChange={(e) => onChange({ ...filters, attentionOnly: e.target.checked })} /> Needs attention only
        </label>
      </div>

      <div className="column-filters-result">
        <span aria-live="polite" data-testid="filter-count">
          Showing {shown} of {total} columns
        </span>
        {isFiltering(filters) && (
          <button type="button" className="button-link" onClick={() => onChange(NO_FILTERS)}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
