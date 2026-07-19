/**
 * Road Alignment Stakeout Module for MetaRDU Desktop v2.0.
 *
 * Provides chainage/offset stakeout for road alignments.
 * Supports horizontal alignment (straights, circular curves, transition spirals)
 * and vertical alignment (parabolic curves).
 *
 * This is the bread-and-butter of engineering surveying — staking out
 * road centerlines, edges, and cross-section points at regular chainage intervals.
 *
 * References:
 *   - RDM 1.3 §5: Kenya Road Design Manual — Alignment
 *   - AASHTO Green Book: Horizontal and Vertical Alignment
 *   - Schofield & Breach Ch. 11: Curve Setting-Out
 */

// ─── Horizontal Alignment ──────────────────────────────────────────

/** Horizontal alignment element. */
export type HAlignElement =
  | { type: "straight"; startChainage: number; endChainage: number; bearing: number }
  | { type: "circular"; startChainage: number; endChainage: number; radius: number; deflection: number; bearingIn: number }
  | { type: "spiral"; startChainage: number; endChainage: number; radius: number; length: number; bearingIn: number; parameter: number };

/** Computed centerline point. */
export interface CenterlinePoint {
  chainage: number;
  easting: number;
  northing: number;
  bearing: number;      // tangent bearing at this chainage
  curvature: number;    // 1/R (0 for straight, 1/R for circular)
  element: string;      // which alignment element
  offset: number;       // 0 for centerline
}

/**
 * Compute centerline coordinates at a given chainage.
 *
 * @param elements Horizontal alignment elements (in chainage order)
 * @param startEasting Starting easting
 * @param startNorthing Starting northing
 * @param startBearing Starting bearing (degrees)
 * @param chainage Target chainage
 */
export function centerlineAtChainage(
  elements: HAlignElement[],
  startEasting: number,
  startNorthing: number,
  startBearing: number,
  chainage: number,
): CenterlinePoint | null {
  let easting = startEasting;
  let northing = startNorthing;
  let bearing = startBearing;
  // prevEndChainage reserved for future continuity-check / gap-detection logic.
  // Kept here as a placeholder so the parameter list reads naturally; will be
  // used when we add gap detection between alignment elements.
  const _prevEndChainage = elements[0]?.startChainage ?? 0;
  void _prevEndChainage;

  for (const el of elements) {
    if (chainage < el.startChainage) break;

    if (chainage >= el.endChainage) {
      // Pass through this entire element
      const result = traverseElement(el, easting, northing, bearing, el.endChainage);
      easting = result.easting;
      northing = result.northing;
      bearing = result.bearing;
      continue;
    }

    // Chainage is within this element
    const result = traverseElement(el, easting, northing, bearing, chainage);
    return {
      chainage,
      easting: result.easting,
      northing: result.northing,
      bearing: result.bearing,
      curvature: result.curvature,
      element: el.type,
      offset: 0,
    };
  }

  return null;
}

function traverseElement(
  el: HAlignElement,
  easting: number,
  northing: number,
  bearing: number,
  targetChainage: number,
): { easting: number; northing: number; bearing: number; curvature: number } {
  const distance = targetChainage - el.startChainage;
  const bearingRad = bearing * Math.PI / 180;

  if (el.type === "straight") {
    const newE = easting + distance * Math.sin(bearingRad);
    const newN = northing + distance * Math.cos(bearingRad);
    return { easting: newE, northing: newN, bearing, curvature: 0 };
  }

  if (el.type === "circular") {
    const R = el.radius;
    const arcLength = distance;
    const angle = arcLength / R; // radians
    const newBearing = bearing + (angle * 180 / Math.PI) * (el.deflection > 0 ? 1 : -1);
    const chord = 2 * R * Math.sin(angle / 2);
    const chordBearing = bearingRad + (angle / 2) * (el.deflection > 0 ? 1 : -1);
    const newE = easting + chord * Math.sin(chordBearing);
    const newN = northing + chord * Math.cos(chordBearing);
    return { easting: newE, northing: newN, bearing: newBearing, curvature: 1 / R };
  }

  if (el.type === "spiral") {
    // Simplified: treat as average of tangent and circular
    const R = el.radius;
    const Ls = el.length;
    const A = el.parameter;
    const angle = distance * distance / (2 * A * A);
    const newBearing = bearing + (angle * 180 / Math.PI) * (el.bearingIn > 0 ? 1 : -1);
    // Approximate coordinate (first-order)
    const newE = easting + distance * Math.sin(bearingRad + angle / 2);
    const newN = northing + distance * Math.cos(bearingRad + angle / 2);
    return { easting: newE, northing: newN, bearing: newBearing, curvature: distance / (R * Ls) };
  }

  return { easting, northing, bearing, curvature: 0 };
}

// ─── Offset stakeout ───────────────────────────────────────────────

/** Stakeout point at an offset from the centerline. */
export function offsetPoint(
  centerline: CenterlinePoint,
  offset: number,
): { easting: number; northing: number; chainage: number; offset: number } {
  // Offset is perpendicular to the tangent
  const bearingRad = centerline.bearing * Math.PI / 180;
  // Right offset = bearing + 90°
  const offsetBearing = bearingRad + Math.PI / 2;
  const easting = centerline.easting + offset * Math.sin(offsetBearing);
  const northing = centerline.northing + offset * Math.cos(offsetBearing);
  return { easting, northing, chainage: centerline.chainage, offset };
}

// ─── Stakeout table generation ─────────────────────────────────────

/** A stakeout point in the table. */
export interface StakeoutPoint {
  pointNumber: string;
  chainage: number;
  offset: number;
  easting: number;
  northing: number;
  elevation: number | null;
  description: string;
}

/**
 * Generate a complete stakeout table for a road alignment.
 *
 * @param elements Alignment elements
 * @param startE Starting easting
 * @param startN Starting northing
 * @param startB Starting bearing
 * @param startChainage Chainage at start
 * @param endChainage Chainage at end
 * @param interval Chainage interval (meters)
 * @param offsets Array of offsets to stake (e.g., [-7.5, 0, 7.5] for edge/center/edge)
 * @param verticalProfile Optional: function returning elevation at chainage
 */
export function generateStakeoutTable(
  elements: HAlignElement[],
  startE: number,
  startN: number,
  startB: number,
  startChainage: number,
  endChainage: number,
  interval: number,
  offsets: number[],
  verticalProfile?: (chainage: number) => number | null,
): StakeoutPoint[] {
  const points: StakeoutPoint[] = [];
  let pointCounter = 1;

  for (let chainage = startChainage; chainage <= endChainage + 0.001; chainage += interval) {
    const cl = centerlineAtChainage(elements, startE, startN, startB, chainage);
    if (!cl) continue;

    for (const offset of offsets) {
      const pt = offsetPoint(cl, offset);
      const elevation = verticalProfile ? verticalProfile(chainage) : null;
      const offsetLabel = offset === 0 ? "CL" : `${offset > 0 ? "R" : "L"} ${Math.abs(offset).toFixed(2)}`;

      points.push({
        pointNumber: `${Math.floor(chainage)}+${String(Math.round((chainage % 1) * 1000)).padStart(3, "0")}-${pointCounter}`,
        chainage,
        offset,
        easting: pt.easting,
        northing: pt.northing,
        elevation,
        description: `${offsetLabel} @ ${chainage.toFixed(3)}`,
      });
      pointCounter++;
    }
  }

  return points;
}

// ─── Vertical alignment ────────────────────────────────────────────

/** Vertical alignment element (parabolic curve). */
export interface VAlignElement {
  type: "grade" | "vertical_curve";
  startChainage: number;
  endChainage: number;
  startElevation: number;
  grade1?: number;  // initial grade (%)
  grade2?: number;  // final grade (%)
  length?: number;  // curve length
}

/**
 * Compute elevation at a chainage from vertical alignment.
 */
export function elevationAtChainage(elements: VAlignElement[], chainage: number): number | null {
  for (const el of elements) {
    if (chainage < el.startChainage || chainage > el.endChainage) continue;

    const dist = chainage - el.startChainage;

    if (el.type === "grade") {
      return el.startElevation + (dist * (el.grade1 ?? 0)) / 100;
    }

    if (el.type === "vertical_curve" && el.grade1 !== undefined && el.grade2 !== undefined && el.length) {
      // Parabolic curve: y = y1 + g1*x + (g2-g1)/(2L) * x²
      const g1 = el.grade1 / 100;
      const g2 = el.grade2 / 100;
      const L = el.length;
      const x = dist;
      return el.startElevation + g1 * x + ((g2 - g1) / (2 * L)) * x * x;
    }
  }

  return null;
}
