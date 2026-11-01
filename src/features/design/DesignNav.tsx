// The sidebar of Design: the table and its columns, searchable and filterable by kind, drawn through a
// window so a table of 300 columns stays quick. The arrow keys move between columns.

import { useVirtualizer } from "@tanstack/react-virtual";
import { Plus, Search, Settings2, TriangleAlert, X } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { KIND_LABELS, KIND_ORDER } from "../../lib/design/defaults";
import type { DesignColumn, DesignKind } from "../../lib/design/types";
import { kindLook } from "./kindLooks";

const ROW_HEIGHT = 40;
const FALLBACK_RECT = { width: 320, height: 640 };

export type DesignView = { view: "table" } | { view: "add" } | { view: "column"; id: string };

export interface DesignNavProps {
  columns: readonly DesignColumn[];
  /** Ids of the columns that have a problem. */
  withProblems: ReadonlySet<string>;
  current: DesignView;
  onView: (view: DesignView) => void;
}

export function DesignNav({ columns, withProblems, current, onView }: DesignNavProps) {
  const id = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<DesignKind | "all">("all");

  const counts: Partial<Record<DesignKind, number>> = {};
  for (const c of columns) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  const q = query.trim().toLowerCase();
  const shown = columns.filter((c) => (kind === "all" || c.kind === kind) && (q === "" || c.name.toLowerCase().includes(q)));
  const filtering = q !== "" || kind !== "all";

  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
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
    getItemKey: (i) => shown[i]?.id ?? i,
  });

  const move = (index: number, e: KeyboardEvent) => {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = Math.min(shown.length - 1, Math.max(0, index + step));
    onView({ view: "column", id: shown[next].id });
    virtualizer.scrollToIndex(next, { align: "auto" });
    requestAnimationFrame(() => scroller.current?.querySelector<HTMLElement>(`[data-index="${next}"] button`)?.focus());
  };

  const currentId = current.view === "column" ? current.id : null;

  return (
    <nav className="column-nav" aria-label="Table design">
      <div className="column-nav-tools">
        <button type="button" className="button button-primary design-add" onClick={() => onView({ view: "add" })}>
          <Plus size={16} strokeWidth={2} aria-hidden="true" /> Add column
        </button>

        {columns.length > 6 && (
          <>
            <div className="search-box" role="search" aria-label="Find a column">
              <Search size={16} strokeWidth={1.75} aria-hidden="true" />
              <label htmlFor={`${id}-search`} className="visually-hidden">
                Search columns
              </label>
              <input id={`${id}-search`} type="search" placeholder={`Search ${columns.length} columns`} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="type-chips" role="group" aria-label="Filter by kind">
              <button type="button" className="type-chip" aria-pressed={kind === "all"} onClick={() => setKind("all")}>
                All <span className="type-chip-count">{columns.length}</span>
              </button>
              {KIND_ORDER.filter((k) => counts[k]).map((k) => {
                const look = kindLook(k);
                const Icon = look.icon;
                return (
                  <button key={k} type="button" className="type-chip" aria-pressed={kind === k} aria-label={`${KIND_LABELS[k]}, ${counts[k]}`} title={`${KIND_LABELS[k]} (${counts[k]})`} onClick={() => setKind(kind === k ? "all" : k)}>
                    <Icon size={15} strokeWidth={1.75} style={{ color: look.color }} aria-hidden="true" />
                    <span className="type-chip-count">{counts[k]}</span>
                  </button>
                );
              })}
            </div>
            <div className="column-nav-result">
              <span aria-live="polite">
                Showing {shown.length} of {columns.length} columns
              </span>
              {filtering && (
                <button
                  type="button"
                  className="button-link"
                  onClick={() => {
                    setQuery("");
                    setKind("all");
                  }}
                >
                  <X size={13} strokeWidth={2} aria-hidden="true" /> Clear filters
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <button type="button" className="column-nav-overview" aria-current={current.view === "table" ? "true" : undefined} onClick={() => onView({ view: "table" })}>
        <Settings2 size={16} strokeWidth={1.75} aria-hidden="true" /> Table settings
      </button>

      <div ref={scroller} className="column-nav-scroll">
        {columns.length === 0 ? (
          <p className="column-nav-empty">No columns yet. Add the first one to start the table.</p>
        ) : shown.length === 0 ? (
          <p className="column-nav-empty">
            <strong>No columns match these filters.</strong> <span>Clear the filters to see every column.</span>
          </p>
        ) : (
          <ul className="column-nav-list" role="list" aria-label="Designed columns" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const c = shown[item.index];
              const look = kindLook(c.kind);
              const Icon = look.icon;
              const active = c.id === currentId;
              return (
                <li key={item.key} data-index={item.index} role="listitem" aria-posinset={item.index + 1} aria-setsize={shown.length} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: item.size, transform: `translateY(${item.start}px)` }}>
                  <button type="button" className="column-nav-item" data-design-column={c.name} aria-current={active ? "true" : undefined} tabIndex={active || (currentId === null && item.index === 0) ? 0 : -1} onClick={() => onView({ view: "column", id: c.id })} onKeyDown={(e) => move(item.index, e)}>
                    <Icon size={16} strokeWidth={1.75} style={{ color: look.color }} aria-hidden="true" />
                    <span className="column-nav-name">{c.name || "(no name)"}</span>
                    <span className="column-nav-flags">{withProblems.has(c.id) && <TriangleAlert size={14} strokeWidth={1.75} className="flag-attention" aria-label="Needs a fix" />}</span>
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
