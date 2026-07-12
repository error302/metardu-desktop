/**
 * Turf helpers — minimal stub for the desktop engine.
 *
 * The upstream metardu has a full turf-based geo helpers module that
 * depends on @turf/turf. For the desktop fork we only need the
 * SurveyPoint type and a few basic helpers that the NLIMS exporter
 * and other modules reference.
 *
 * M4 will expand this with real turf-based area/distance calculations
 * for topographic workflows.
 */

export interface SurveyPoint {
  /** Point number / label */
  number?: string;
  /** Easting in metres (project CRS) */
  easting: number;
  /** Northing in metres (project CRS) */
  northing: number;
  /** Elevation in metres (optional) */
  elevation?: number;
  /** Feature code (optional) */
  code?: string;
  /** Description (optional) */
  description?: string;
}

/**
 * Compute the area of a polygon using the shoelace formula.
 * Points must be in order (clockwise or counter-clockwise).
 */
export function polygonArea(points: SurveyPoint[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].easting * points[j].northing;
    area -= points[j].easting * points[i].northing;
  }
  return Math.abs(area) / 2;
}

/**
 * Compute the perimeter of a polygon.
 */
export function polygonPerimeter(points: SurveyPoint[]): number {
  if (points.length < 2) return 0;
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const dx = points[j].easting - points[i].easting;
    const dy = points[j].northing - points[i].northing;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  return perimeter;
}

/**
 * Distance between two points.
 */
export function distance(a: SurveyPoint, b: SurveyPoint): number {
  const dx = b.easting - a.easting;
  const dy = b.northing - a.northing;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Bearing from point a to point b, in degrees (0-360, WCB).
 */
export function bearing(a: SurveyPoint, b: SurveyPoint): number {
  const dx = b.easting - a.easting;
  const dy = b.northing - a.northing;
  const angle = Math.atan2(dx, dy) * (180 / Math.PI);
  return (angle + 360) % 360;
}
