// One card per column (FR-009): name, detected type, status, a few facts, and a small chart.

import { Badge } from "../../components/Badge";
import type { ColumnProfile } from "../../lib/profile/types";
import { Sparkline } from "./Sparkline";
import { reasonText, sparkBars, summaryLines, typeLabel } from "./summary";

export interface ColumnCardProps {
  profile: ColumnProfile;
}

export function ColumnCard({ profile }: ColumnCardProps) {
  const dropped = profile.exclude === "drop";
  const bars = sparkBars(profile);
  const lines = summaryLines(profile);

  return (
    <article className="card column-card" data-column={profile.name} data-status={profile.status}>
      <header className="column-card-header">
        <h3 className="column-card-name">{profile.name}</h3>
        <div className="column-card-badges">
          <Badge variant={profile.type === "unsupported" ? "danger" : "info"}>{typeLabel(profile.type)}</Badge>
          {profile.status === "needs_attention" && <Badge variant="warning">Needs attention</Badge>}
          {dropped && <Badge variant="neutral">Left out</Badge>}
          {profile.exclude === "keep_as_na" && <Badge variant="neutral">Kept as all-missing</Badge>}
        </div>
      </header>

      <div className="column-card-body">
        <ul className="column-card-facts">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <Sparkline bars={bars} label={`Distribution of ${profile.name}`} />
      </div>

      {profile.attentionReasons.length > 0 && (
        <ul className="column-card-reasons">
          {profile.attentionReasons.map((code) => (
            <li key={code}>{reasonText(code)}</li>
          ))}
        </ul>
      )}
    </article>
  );
}
