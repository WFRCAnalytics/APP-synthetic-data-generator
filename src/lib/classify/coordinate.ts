// Coordinates (specs/013): a column of latitudes, longitudes or projected x and y values says where people are, so the spec
// keeps only its bounding box and its decimal places (constitution Principle II), never the shape of the real distribution.
// The values are spread evenly inside the box. A column is taken for a coordinate by its name and its range, and the person can
// say yes or no on Review.

export type CoordinateAxis = "lat" | "lon" | "x" | "y";

export const COORDINATE_AXES: readonly CoordinateAxis[] = ["lat", "lon", "x", "y"];

export const AXIS_LABELS: Record<CoordinateAxis, string> = {
  lat: "Latitude",
  lon: "Longitude",
  x: "X (easting)",
  y: "Y (northing)",
};

/** The most decimal places a coordinate keeps. */
export const MAX_COORDINATE_DECIMALS = 8;

const LAT = new Set(["lat", "latitude", "lat_deg", "latdd", "latdec"]);
const LON = new Set(["lon", "lng", "long", "longitude", "lon_deg", "londd", "londec"]);
const X = new Set([
  "x",
  "xcoord",
  "x_coord",
  "easting",
  "eastings",
  "east",
  "x_coordinate",
  "xcoordinate",
]);
const Y = new Set([
  "y",
  "ycoord",
  "y_coord",
  "northing",
  "northings",
  "north",
  "y_coordinate",
  "ycoordinate",
]);

/** The range a latitude or a longitude must lie in; projected axes have none. */
export function axisRange(axis: CoordinateAxis): [number, number] | null {
  return axis === "lat" ? [-90, 90] : axis === "lon" ? [-180, 180] : null;
}

/** Whether a bounding box is a possible one for the axis. */
export function boxFits(axis: CoordinateAxis, min: number, max: number): boolean {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return false;
  const range = axisRange(axis);
  return range === null || (min >= range[0] && max <= range[1]);
}

/**
 * The axis a column looks like, from its name (its words, split at anything that is not a letter or digit, and the whole name) and
 * its range, or null. A name that fits and a range that cannot be the axis (a latitude of 400) is not taken.
 */
export function guessAxis(name: string, min: number, max: number): CoordinateAxis | null {
  const lower = name.trim().toLowerCase();
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  const tokens = [lower, ...words, lower.replace(/[^a-z0-9]+/g, "_")];
  const axis: CoordinateAxis | null = tokens.some((t) => LAT.has(t))
    ? "lat"
    : tokens.some((t) => LON.has(t))
      ? "lon"
      : tokens.some((t) => X.has(t))
        ? "x"
        : tokens.some((t) => Y.has(t))
          ? "y"
          : null;
  if (axis === null) return null;
  if (!boxFits(axis, min, max)) return null;
  // A plain x or y of small whole-number size is more often a position on a chart than a place.
  if ((axis === "x" || axis === "y") && max - min < 1000) return null;
  return axis;
}
