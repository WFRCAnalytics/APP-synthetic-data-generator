// Whether a number column is a coordinate (FR-011): a latitude, longitude or map position says where people are, so only its bounding
// box and decimal places are kept and the values are spread evenly inside the box. How the app read the column, so it sits with the type.

import { InfoTip } from "../../components/InfoTip";
import { useId } from "react";
import { AXIS_LABELS, COORDINATE_AXES, type CoordinateAxis } from "../../lib/classify/coordinate";
import type { ColumnProfile } from "../../lib/profile/types";

export interface CoordinateControlProps {
  profile: ColumnProfile;
  onCoordinate: (axis: CoordinateAxis | null) => void;
}

export function CoordinateControl({ profile, onCoordinate }: CoordinateControlProps) {
  const id = useId();
  if (profile.summary.kind !== "numeric" || (profile.type !== "float" && profile.type !== "integer")) return null;
  return (
    <div className="field">
      <span className="label-row">
        <label htmlFor={`${id}-coordinate`}>Coordinate</label>
        <InfoTip label="More information">
          A latitude, longitude or map position says where people are. As a coordinate, only its bounding box (lowest and highest value) and
          decimal places are kept, and values are spread evenly inside the box.
        </InfoTip>
      </span>
      <select id={`${id}-coordinate`} value={profile.coordinate ?? ""} onChange={(e) => onCoordinate(e.target.value === "" ? null : (e.target.value as CoordinateAxis))}>
        <option value="">No, an ordinary number</option>
        {COORDINATE_AXES.map((axis) => (
          <option key={axis} value={axis}>
            {AXIS_LABELS[axis]}
          </option>
        ))}
      </select>
    </div>
  );
}
