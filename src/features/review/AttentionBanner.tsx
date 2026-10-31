// A banner naming the columns the profiler was unsure about: possible identifiers, possible sentinels,
// integer columns near the categorical limit, and anything left out of the fake file (FR-010).

import { TriangleAlert } from "lucide-react";
import type { ColumnProfile } from "../../lib/profile/types";
import { reasonText } from "./summary";

const MAX_NAMES = 8;

export interface AttentionBannerProps {
  profiles: readonly ColumnProfile[];
  onlyAttention: boolean;
  onToggle: () => void;
}

export function AttentionBanner({ profiles, onlyAttention, onToggle }: AttentionBannerProps) {
  const attention = profiles.filter((p) => p.status !== "ok");
  const leftOut = profiles.filter((p) => p.exclude === "drop").length;
  if (attention.length === 0) return null;

  // The most common reasons, so the banner says why, not just how many.
  const tally = new Map<string, number>();
  for (const p of attention) for (const r of p.attentionReasons) tally.set(r, (tally.get(r) ?? 0) + 1);
  const reasons = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

  return (
    <div className="banner banner-warning attention-banner" role="status">
      <TriangleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
      <div>
        <p className="attention-banner-title">
          {attention.length} {attention.length === 1 ? "column needs" : "columns need"} a look
          {leftOut > 0 ? `; ${leftOut} will be left out of the fake file` : ""}.
        </p>
        <p className="attention-banner-names">
          {attention.slice(0, MAX_NAMES).map((p) => p.name).join(", ")}
          {attention.length > MAX_NAMES ? `, and ${attention.length - MAX_NAMES} more` : ""}
        </p>
        <ul className="attention-banner-reasons">
          {reasons.map(([code, n]) => (
            <li key={code}>
              {n} &times; {reasonText(code as ColumnProfile["attentionReasons"][number])}
            </li>
          ))}
        </ul>
        <button type="button" className="button-link" onClick={onToggle}>
          {onlyAttention ? "Show all columns" : "Show only these columns"}
        </button>
      </div>
    </div>
  );
}
