// Small status/category pill, used wherever a value reads better as a labeled chip than
// plain text — reviewer type, rank, import-result counts. Every variant below reuses an
// already-verified color pairing rather than inventing a new tinted background: success/
// danger/warning/info each name a pairing tokens.css or contrast.test.ts already computes
// elsewhere (button-primary, accent badge text, success/danger foregrounds); only "neutral"
// is new, verified alongside this component (see contrast.test.ts).

import type { ReactNode } from "react";
import "./Badge.css";

export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info";

export interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
}

export function Badge({ variant = "neutral", children }: BadgeProps) {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}
