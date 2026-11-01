// The sidebar of Review: search, filters by type and by "needs attention", and the list of columns.
// A table of 100 to 120 columns is a long list, so it is drawn through a window (only the rows near the
// view exist in the page), and the arrow keys move from one column to the next.

import { useVirtualizer } from "@tanstack/react-virtual";
import { Ban, EyeOff, Info, Search, TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import type { ColumnProfile } from "../../lib/profile/types";
import { isFiltering, NO_FILTERS, type Filters } from "./filter";
import { typeLabel } from "./summary";
import { typeLook } from "./typeIcons";

const ROW_HEIGHT = 40;
const FALLBACK_RECT = { width: 320, height: 640 };

export interface ColumnNavProps {
  /** The columns that pass the filters, in table order. */
  shown: readonly ColumnProfile[];
  total: number;
  filters: Filters;
  onFilters: (filters: Filters) => void;
  /** How many columns have each type. */
  typeCounts: Record<string, number>;
  /** The selected column's name, or null for the overview. */
  selected: string | null;
  onSelect: (name: string | null) => void;
}

export function ColumnNav({ shown, total, filters, onFilters, typeCounts, selected, onSelect }: ColumnNavProps) {
  const id = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const types = Object.keys(typeCounts).sort((a, b) => typeLabel(a).localeCompare(typeLabel(b)));

  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    // Until the list has been measured (and wherever it cannot be, as in a test), assume a tall one.
    initialRect: FALLBACK_RECT,
    observeElementRect: (instance, cb) => {
      const el = instance.scrollElement;
      if (!el) return;
      const measure = () => {
        const r = el.getBoundingClientRect();
        cb(r.height > 0 ? { width: r.width, height: r.height } : FALLBACK_RECT);
      };
      measure();
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    },
    getItemKey: (i) => shown[i]?.name ?? i,
  });

  // A column picked from elsewhere (the next button) is brought into view.
  const selectedIndex = selected === null ? -1 : shown.findIndex((p) => p.name === selected);
  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [selectedIndex, virtualizer]);

  const move = (index: number, e: KeyboardEvent) => {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : e.key === "Home" ? -index : e.key === "End" ? shown.length : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = Math.min(shown.length - 1, Math.max(0, index + step));
    onSelect(shown[next].name);
    virtualizer.scrollToIndex(next, { align: "auto" });
    // The row may not exist yet; focus it once it does.
    requestAnimationFrame(() => scroller.current?.querySelector<HTMLElement>(`[data-index="${next}"] button`)?.focus());
  };

  return (
    <nav className="column-nav" aria-label="Columns">
      <div className="column-nav-tools" role="search" aria-label="Filter columns">
        <div className="search-box">
          <Search size={16} strokeWidth={1.75} aria-hidden="true" />
          <label htmlFor={`${id}-search`} className="visually-hidden">
            Search columns
          </label>
          <input id={`${id}-search`} type="search" placeholder={`Search ${total} columns`} value={filters.query} onChange={(e) => onFilters({ ...filters, query: e.target.value })} />
        </div>

        <div className="type-chips" role="group" aria-label="Filter by type">
          <button type="button" className="type-chip" aria-pressed={filters.type === "all"} onClick={() => onFilters({ ...filters, type: "all" })} title="All types">
            All <span className="type-chip-count">{total}</span>
          </button>
          {types.map((t) => {
            const look = typeLook(t);
            const Icon = look.icon;
            const label = typeLabel(t);
            return (
              <button key={t} type="button" className="type-chip" aria-pressed={filters.type === t} aria-label={`${label}, ${typeCounts[t]}`} title={`${label} (${typeCounts[t]})`} onClick={() => onFilters({ ...filters, type: filters.type === t ? "all" : t })}>
                <Icon size={15} strokeWidth={1.75} style={{ color: look.color }} aria-hidden="true" />
                <span className="type-chip-count">{typeCounts[t]}</span>
              </button>
            );
          })}
        </div>

        <label className="toggle-chip" htmlFor={`${id}-attention`}>
          <input id={`${id}-attention`} type="checkbox" checked={filters.attentionOnly} onChange={(e) => onFilters({ ...filters, attentionOnly: e.target.checked })} />
          <TriangleAlert size={15} strokeWidth={1.75} aria-hidden="true" /> Needs attention only
        </label>

        <div className="column-nav-result">
          <span aria-live="polite" data-testid="filter-count">
            Showing {shown.length} of {total} columns
          </span>
          {isFiltering(filters) && (
            <button type="button" className="button-link" onClick={() => onFilters(NO_FILTERS)}>
              <X size={13} strokeWidth={2} aria-hidden="true" /> Clear filters
            </button>
          )}
        </div>
      </div>

      <button type="button" className="column-nav-overview" aria-current={selected === null ? "true" : undefined} onClick={() => onSelect(null)}>
        <Info size={16} strokeWidth={1.75} aria-hidden="true" /> Overview
      </button>

      <div ref={scroller} className="column-nav-scroll">
        {shown.length === 0 ? (
          <p className="column-nav-empty">
            <strong>No columns match these filters.</strong> <span>Clear the filters to see every column.</span>
          </p>
        ) : (
          <ul className="column-nav-list" role="list" aria-label="Columns" data-virtual="true" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const p = shown[item.index];
              const look = typeLook(p.type);
              const Icon = look.icon;
              const active = p.name === selected;
              return (
                <li
                  key={item.key}
                  data-index={item.index}
                  role="listitem"
                  aria-posinset={item.index + 1}
                  aria-setsize={shown.length}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", height: item.size, transform: `translateY(${item.start}px)` }}
                >
                  <button
                    type="button"
                    className="column-nav-item"
                    data-nav-column={p.name}
                    data-status={p.status}
                    data-dropped={p.exclude === "drop" ? "true" : undefined}
                    aria-current={active ? "true" : undefined}
                    tabIndex={active || (selected === null && item.index === 0) ? 0 : -1}
                    onClick={() => onSelect(p.name)}
                    onKeyDown={(e) => move(item.index, e)}
                  >
                    <Icon size={16} strokeWidth={1.75} style={{ color: look.color }} aria-hidden="true" />
                    <span className="column-nav-name">{p.name}</span>
                    <span className="column-nav-flags">
                      {p.type === "unsupported" ? (
                        <Ban size={14} strokeWidth={1.75} aria-label="Unsupported" />
                      ) : p.exclude === "drop" ? (
                        <EyeOff size={14} strokeWidth={1.75} aria-label="Left out" />
                      ) : null}
                      {p.status === "needs_attention" && <TriangleAlert size={14} strokeWidth={1.75} className="flag-attention" aria-label="Needs attention" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </nav>
  );
}
