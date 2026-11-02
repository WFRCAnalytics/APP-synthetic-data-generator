// One icon and one colour family per column type, so a long list can be read by shape before the
// words. The colours are the brand chart tokens (graphical contrast, not text).

import {
  Ban,
  CalendarClock,
  Calendar,
  Circle,
  Clock,
  DecimalsArrowRight,
  Fingerprint,
  Hash,
  Tags,
  TextAlignStart,
  ToggleLeft,
  Type,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export interface TypeLook {
  icon: LucideIcon;
  /** A CSS colour (a chart token) for the icon. */
  color: string;
}

const LOOKS: Record<string, TypeLook> = {
  integer: { icon: Hash, color: "var(--chart-1)" },
  float: { icon: DecimalsArrowRight, color: "var(--chart-1)" },
  categorical: { icon: Tags, color: "var(--chart-4)" },
  boolean: { icon: ToggleLeft, color: "var(--chart-2)" },
  date: { icon: Calendar, color: "var(--chart-3)" },
  datetime: { icon: CalendarClock, color: "var(--chart-3)" },
  time: { icon: Clock, color: "var(--chart-3)" },
  survey_id: { icon: Fingerprint, color: "var(--chart-5)" },
  personal: { icon: UserRound, color: "var(--chart-6)" },
  free_text: { icon: TextAlignStart, color: "var(--chart-7)" },
  short_string: { icon: Type, color: "var(--chart-7)" },
  empty: { icon: Circle, color: "var(--color-wfrc-gray)" },
  unsupported: { icon: Ban, color: "var(--color-danger-text)" },
};

export const typeLook = (type: string): TypeLook => LOOKS[type] ?? { icon: Circle, color: "var(--color-wfrc-gray)" };
