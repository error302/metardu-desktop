/**
 * ellipse.ts — error-ellipse display math for the MapView (pure).
 *
 * Survey LS adjustments produce a 2D error ellipse per point: semi-major
 * and semi-minor axes in metres, oriented degrees clockwise from north
 * (surveying convention). This module converts that into a WGS84 polygon
 * ring (for the OpenLayers overlay) and a human-readable summary (for the
 * beacon popup). No ol, no React, no Electron — pure so it can be
 * unit-tested headless alongside map-geometry.
 *
 * # Metre → degree approximation
 *
 * The MapView runs under `useGeographic()`, so map coordinates are WGS84
 * decimal degrees. A local (not global) scale converts ellipse axes:
 *
 *   kLat ≈ 110,574 m/°  (WGS84 mean meridian arc)
 *   kLon ≈ 111,320 × cos(lat) m/°  (parallel arc at the beacon)
 *
 * Fine for display ellipses (sub-metre axes) and GPS accuracy circles —
 * the inaccuracy over a few metres of offset is negligible at any zoom.
 */

import type { MapUncertainty } from "./map-geometry.js";

/** WGS84 mean metres per degree of latitude. */
const M_PER_DEG_LAT = 110_574;

/**
 * Build a closed polygon ring (WGS84 lon/lat degrees) tracing the error
 * ellipse around a point.
 *
 * The ellipse is parameterized as P(u) = c + a·cos(u)·û + b·sin(u)·v̂ with
 * û the major-axis unit vector (θ clockwise from north → (sin θ, cos θ) in
 * east/north components) and v̂ = (cos θ, −sin θ) its perpendicular. The
 * degenerate case θ = 0 (major axis due north) is exact; any θ works.
 *
 * @param centerLon  Ellipse centre longitude (WGS84 degrees)
 * @param centerLat  Ellipse centre latitude (WGS84 degrees)
 * @param semiMajorM Semi-major axis, metres
 * @param semiMinorM Semi-minor axis, metres
 * @param orientationDeg Semi-major axis orientation, degrees clockwise from north
 * @param samples    Ring resolution (default 72). The ring repeats the
 *                   first vertex at the end so it is a closed ring.
 */
export function ellipseRingDegrees(
  centerLon: number,
  centerLat: number,
  semiMajorM: number,
  semiMinorM: number,
  orientationDeg: number,
  samples = 72,
): Array<[number, number]> {
  const kLon = 111_320 * Math.cos((centerLat * Math.PI) / 180);
  const kLat = M_PER_DEG_LAT;
  const theta = (orientationDeg * Math.PI) / 180;
  // Guard degenerate / malformed axes: non-positive or non-finite values
  // collapse to zero rather than producing NaN coordinates.
  const a = semiMajorM > 0 && Number.isFinite(semiMajorM) ? semiMajorM : 0;
  const b = semiMinorM > 0 && Number.isFinite(semiMinorM) ? semiMinorM : 0;
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= samples; i++) {
    const u = (i / samples) * 2 * Math.PI;
    const e = a * Math.cos(u) * Math.sin(theta) - b * Math.sin(u) * Math.cos(theta);
    const n = a * Math.cos(u) * Math.cos(theta) + b * Math.sin(u) * Math.sin(theta);
    ring.push([centerLon + e / kLon, centerLat + n / kLat]);
  }
  return ring;
}

/** Format an axis length as millimetres (sub-metre) or metres. */
function fmtAxis(m: number): string {
  return m >= 1 ? `${m.toFixed(3)} m` : `${(m * 1000).toFixed(1)} mm`;
}

/**
 * Human-readable summary of a beacon's uncertainty for the popup:
 *
 *   - Adjusted point with an ellipse:
 *       "95% error ellipse: a = 12.0 mm, b = 8.0 mm, θ = 45.3°"
 *   - Known / fixed point:
 *       "Fixed control point — no propagated uncertainty"
 *   - Adjusted but no ellipse (degenerate config):
 *       "Adjusted — degenerate configuration, no ellipse"
 *   - No record at all:
 *       "No uncertainty record"
 */
export function formatUncertainty(u: MapUncertainty | null | undefined): string {
  if (!u) return "No uncertainty record";
  if (!u.adjusted) {
    switch (u.reason) {
      case "fixed-control":
        return "Fixed control point — no propagated uncertainty";
      case "field-data":
        return "Field reading — no LS adjustment";
      case "degenerate-configuration":
        return "Degenerate configuration — no ellipse";
      default:
        return "Known point — no propagated uncertainty";
    }
  }
  if (u.semiMajorAxis === undefined || u.semiMinorAxis === undefined) {
    return u.reason === "degenerate-configuration"
      ? "Adjusted — degenerate configuration, no ellipse"
      : "Adjusted — no error ellipse computed";
  }
  const level = u.confidenceLevel !== undefined ? `${Math.round(u.confidenceLevel * 100)}%` : "95%";
  const orientation = u.orientation !== undefined ? `, θ = ${u.orientation.toFixed(1)}°` : "";
  return `${level} error ellipse: a = ${fmtAxis(u.semiMajorAxis)}, b = ${fmtAxis(u.semiMinorAxis)}${orientation}`;
}
