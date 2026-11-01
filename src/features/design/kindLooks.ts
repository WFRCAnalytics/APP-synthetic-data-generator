// The icon and colour of each kind of designed column. They reuse the look of the matching column type
// on Review, so a column keeps its icon from design to review.

import type { LucideIcon } from "lucide-react";
import { typeLook } from "../review/typeIcons";
import type { DesignKind } from "../../lib/design/types";

const TYPE_OF: Record<DesignKind, string> = {
  integer: "integer",
  decimal: "float",
  category: "categorical",
  yesno: "boolean",
  date: "date",
  datetime: "datetime",
  id: "survey_id",
  personal: "personal",
  text: "free_text",
};

export const kindLook = (kind: DesignKind): { icon: LucideIcon; color: string } => typeLook(TYPE_OF[kind]);
