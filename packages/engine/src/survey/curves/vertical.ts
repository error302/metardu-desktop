/**
 * Vertical Curve Calculations
 * 
 * Parabolic vertical curve design for road and railway alignments.
 * 
 * References:
 * - Schofield, W. (2001) "Engineering Surveying"
 * - AASHTO Green Book
 */

// ─── Types ───────────────────────────────────────────────────────

export interface VerticalCurveInput {
  /** Grade of approaching tangent (%). Positive = uphill. e.g., +2.5 */
  g1: number;
  /** Grade of departing tangent (%) */
  g2: number;
  /** Length of vertical curve (meters). Must be positive. */
  length: number;
  /** Elevation at PVC (Point of Vertical Curvature) in meters */
  pvcElevation: number;
  /** Chainage/station of PVC in meters */
  pvcChainage: number;
}

export interface VerticalCurveResult {
  g1: number;
  g2: number;
  length: number;
  pvcElevation: number;
  pvcChainage: number;
  pvtElevation: number;
  pvtChainage: number;
  /** Algebraic difference in grades (A = g2 - g1) */
  A: number;
  /** Rate of change of grade (K = L / |A|) */
  K: number;
  /** Elevation at the high/low point */
  turningPointElevation: number;
  /** Chainage at the high/low point */
  turningPointChainage: number;
  /** Distance from PVC to turning point */
  turningPointDistance: number;
  /** Is the curve crest (A < 0) or sag (A > 0) */
  curveType: 'crest' | 'sag';
}

export interface VerticalCurveStationResult {
  chainage: number;
  distanceFromPVC: number;
  elevation: number;
  grade: number;
  tangentOffset: number;
}

// ─── Core Functions ──────────────────────────────────────────────

/**
 * Compute vertical curve parameters.
 * 
 * The parabolic vertical curve formula:
 *   y = y_PVC + g1 × x + (A / (2L)) × x²
 * 
 * Where:
 *   x = distance from PVC
 *   A = g2 - g1 (algebraic difference in grades)
 *   L = curve length
 */
export function computeVerticalCurve(input: VerticalCurveInput): VerticalCurveResult {
  const { g1, g2, length, pvcElevation, pvcChainage } = input;
  
  const A = g2 - g1;
  const K = length / Math.abs(A);
  
  // PVT elevation and chainage
  const pvtElevation = pvcElevation + (g1 / 100) * length;
  const pvtChainage = pvcChainage + length;
  
  // Turning point (high point for crest, low point for sag)
  // dy/dx = g1 + (A/L) × x = 0 → x = -g1 × L / A
  let turningPointDistance: number;
  let turningPointElevation: number;
  let turningPointChainage: number;
  
  if (Math.abs(A) < 1e-10) {
    // No curve — grades are the same
    turningPointDistance = 0;
    turningPointElevation = pvcElevation;
    turningPointChainage = pvcChainage;
  } else {
    turningPointDistance = (-g1 * length) / A;
    
    // Check if turning point is within the curve
    if (turningPointDistance < 0 || turningPointDistance > length) {
      // No turning point within the curve
      turningPointDistance = turningPointDistance < 0 ? 0 : length;
    }
    
    turningPointElevation = pvcElevation + 
      (g1 / 100) * turningPointDistance + 
      (A / (200 * length)) * turningPointDistance * turningPointDistance;
    turningPointChainage = pvcChainage + turningPointDistance;
  }
  
  const curveType = A < 0 ? 'crest' : 'sag';
  
  return {
    g1,
    g2,
    length,
    pvcElevation,
    pvcChainage,
    pvtElevation,
    pvtChainage,
    A: Math.round(A * 10000) / 10000,
    K: Math.round(K * 100) / 100,
    turningPointElevation: Math.round(turningPointElevation * 1000) / 1000,
    turningPointChainage: Math.round(turningPointChainage * 1000) / 1000,
    turningPointDistance: Math.round(turningPointDistance * 1000) / 1000,
    curveType,
  };
}

/**
 * Compute elevations at regular intervals along a vertical curve.
 */
export function computeVerticalCurveStations(
  curve: VerticalCurveResult,
  interval: number = 10
): VerticalCurveStationResult[] {
  const stations: VerticalCurveStationResult[] = [];
  const { g1, A, length, pvcElevation, pvcChainage } = curve;
  
  const numStations = Math.floor(length / interval);
  
  for (let i = 0; i <= numStations; i++) {
    const x = i * interval;
    const elevation = pvcElevation + 
      (g1 / 100) * x + 
      (A / (200 * length)) * x * x;
    const grade = g1 + (A / length) * x;
    const tangentElevation = pvcElevation + (g1 / 100) * x;
    const tangentOffset = elevation - tangentElevation;
    
    stations.push({
      chainage: Math.round((pvcChainage + x) * 1000) / 1000,
      distanceFromPVC: x,
      elevation: Math.round(elevation * 1000) / 1000,
      grade: Math.round(grade * 10000) / 10000,
      tangentOffset: Math.round(tangentOffset * 1000) / 1000,
    });
  }
  
  // Add PVT station if not at interval
  const lastStation = stations[stations.length - 1];
  if (Math.abs(lastStation.distanceFromPVC - length) > 0.01) {
    const elevation = pvcElevation + 
      (g1 / 100) * length + 
      (A / (200 * length)) * length * length;
    
    stations.push({
      chainage: curve.pvtChainage,
      distanceFromPVC: length,
      elevation: Math.round(elevation * 1000) / 1000,
      grade: curve.g2,
      tangentOffset: Math.round((elevation - curve.pvtElevation) * 1000) / 1000,
    });
  }
  
  return stations;
}
