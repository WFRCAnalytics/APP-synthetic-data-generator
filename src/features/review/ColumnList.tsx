// The list of column cards (FR-010, FR-032). A table of 100 to 120 columns is a lot of cards, so a
// long list is drawn through a window: only the cards near the screen exist in the page, and the
// rest are built as they scroll into view. A short list is a plain grid.

import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ColumnProfile } from "../../lib/profile/types";

/** Lists at or below this length are drawn whole. */
export const VIRTUALIZE_ABOVE = 100;
const ESTIMATED_CARD_HEIGHT = 300;
const GAP = 12;

export interface ColumnListProps {
  profiles: readonly ColumnProfile[];
  renderCard: (profile: ColumnProfile) => ReactNode;
}

export function ColumnList({ profiles, renderCard }: ColumnListProps) {
  if (profiles.length <= VIRTUALIZE_ABOVE) {
    return <div className="column-grid">{profiles.map((p) => renderCard(p))}</div>;
  }
  return <VirtualColumnList profiles={profiles} renderCard={renderCard} />;
}

function VirtualColumnList({ profiles, renderCard }: ColumnListProps) {
  const container = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => setMargin(container.current?.offsetTop ?? 0), []);

  const virtualizer = useWindowVirtualizer({
    count: profiles.length,
    estimateSize: () => ESTIMATED_CARD_HEIGHT,
    overscan: 6,
    gap: GAP,
    scrollMargin: margin,
    // Keep a card's identity when the list is filtered, so an open Settings section stays open.
    getItemKey: (i) => profiles[i]?.name ?? i,
  });

  return (
    <div ref={container} className="column-list-virtual" role="list" aria-label="Columns" data-virtual="true" style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
      {virtualizer.getVirtualItems().map((item) => (
        <div
          key={item.key}
          ref={virtualizer.measureElement}
          data-index={item.index}
          role="listitem"
          aria-posinset={item.index + 1}
          aria-setsize={profiles.length}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start - margin}px)` }}
        >
          {renderCard(profiles[item.index])}
        </div>
      ))}
    </div>
  );
}
