/**
 * Sea Level / Ellipsoid Reduction Module
 * 
 * Reduces measured distances from ground level to the ellipsoid surface.
 * In Nairobi (~1700m elevation), this is a 267 ppm correction —
 * 267mm per kilometer of uncorrected distance.
 * 
 * This MUST be applied BEFORE the grid scale factor in the correction
 * pipeline. The full reduction chain is:
 * 
 *   Slope → Horizontal → Sea Level → Grid
 * 
 * Reference:
 * - Clark, D. (1975) "Plane and Geodetic Surveying"
 * - Bomford, G. (1980) "Geodesy"
 */

import { computeMeanEarthRadius, WGS84_A, WGS84_E2 } from './curvature-refraction';

// ─── Types ───────────────────────────────────────────────────────

export interface SeaLevelReductionInput {
  /** Horizontal distance measured at ground level (meters) */
  horizontalDistance: number;
  /** Mean height of the measured line above the ellipsoid (meters)
   *  If orthometric height is known, add geoid undulation N:
   *  h_ellipsoid = h_orthometric + N
   */
  heightAboveEllipsoid?: number;
  /** Latitude in decimal degrees (for computing Earth radius) */
  latitude?: number;
  /** Geoid undulation N at the point (meters)
   *  Positive = geoid above ellipsoid
   *  For Kenya: N ≈ -10 to -20m (EGM96)
   *  Set to 0 if using ellipsoidal heights directly
   */
  geoidUndulation?: number;
  /** Orthometric height (height above geoid/MSL) in meters
   *  Used to compute ellipsoidal height if not provided directly
   */
  orthometricHeight?: number;
}

export interface SeaLevelReductionResult {
  /** Original ground-level horizontal distance (meters) */
  groundDistance: number;
  /** Reduced ellipsoidal distance (meters) */
  ellipsoidalDistance: number;
  /** Reduction in meters */
  reductionMeters: number;
  /** Reduction in ppm */
  reductionPPM: number;
  /** Mean height above ellipsoid used (meters) */
  meanHeight: number;
  /** Earth radius used (meters) */
  earthRadius: number;
  /** Latitude used */
  latitude: number;
  /** Geoid undulation used (meters) */
  geoidUndulation: number;
}

// ─── Constants ───────────────────────────────────────────────────

/** Kenya geoid undulation estimates (EGM96) — meters */
export const KENYA_GEOID_UNDULATION: Record<string, number> = {
  nairobi: -12,
  mombasa: -8,
  kisumu: -15,
  eldoret: -14,
  nakuru: -13,
  // Default for Kenya
  default: -12,
};

// ─── Core Functions ──────────────────────────────────────────────

/**
 * Reduce a ground-level horizontal distance to the ellipsoid.
 * 
 * d_ellipsoid = d_ground × R / (R + h)
 * 
 * Where:
 *   R = mean radius of Earth at latitude
 *   h = mean height of the measured line above the ellipsoid
 * 
 * At Nairobi (h ≈ 1700m, R ≈ 6378000m):
 *   Reduction = 1700 / 6378000 = 266.5 ppm
 *   For a 1km line: reduction = 266.5mm
 * 
 * @param input - Reduction parameters
 * @returns Reduction result
 */
export function applySeaLevelReduction(
  input: SeaLevelReductionInput
): SeaLevelReductionResult {
  const {
    horizontalDistance,
    latitude = 0,
    geoidUndulation = 0,
    orthometricHeight,
  } = input;
  
  // Compute ellipsoidal height
  let heightAboveEllipsoid = input.heightAboveEllipsoid;
  
  // If orthometric height is given but ellipsoidal height isn't,
  // compute ellipsoidal height from orthometric + geoid undulation
  if (orthometricHeight !== undefined && heightAboveEllipsoid === undefined) {
    heightAboveEllipsoid = orthometricHeight + geoidUndulation;
  }
  
  if (heightAboveEllipsoid === undefined) {
    throw new Error('Either heightAboveEllipsoid or orthometricHeight must be provided');
  }
  
  if (horizontalDistance <= 0) {
    throw new Error(`Horizontal distance must be positive, got ${horizontalDistance}`);
  }
  
  // Compute Earth radius at latitude
  const R = computeMeanEarthRadius(latitude);
  
  // Apply reduction
  // d_ellipsoid = d_ground × R / (R + h)
  const reductionFactor = R / (R + heightAboveEllipsoid);
  const ellipsoidalDistance = horizontalDistance * reductionFactor;
  
  const reductionMeters = horizontalDistance - ellipsoidalDistance;
  const reductionPPM = (reductionMeters / horizontalDistance) * 1e6;
  
  return {
    groundDistance: horizontalDistance,
    ellipsoidalDistance,
    reductionMeters: Math.round(reductionMeters * 1e6) / 1e6,
    reductionPPM: Math.round(reductionPPM * 100) / 100,
    meanHeight: heightAboveEllipsoid,
    earthRadius: R,
    latitude,
    geoidUndulation,
  };
}

/**
 * Quick sea level reduction — returns just the reduced distance.
 */
export function quickSeaLevelReduction(
  horizontalDistance: number,
  heightAboveEllipsoid: number,
  latitude: number = 0
): number {
  const R = computeMeanEarthRadius(latitude);
  return horizontalDistance * R / (R + heightAboveEllipsoid);
}

/**
 * Compute the reduction factor for a given height and latitude.
 * Useful for checking the magnitude of the correction.
 */
export function computeReductionFactor(
  heightAboveEllipsoid: number,
  latitude: number = 0
): { factor: number; ppm: number } {
  const R = computeMeanEarthRadius(latitude);
  const factor = R / (R + heightAboveEllipsoid);
  const ppm = (1 - factor) * 1e6;
  
  return {
    factor,
    ppm: Math.round(ppm * 100) / 100,
  };
}

/**
 * Get estimated geoid undulation for a Kenya location.
 * Uses EGM96 approximate values.
 * 
 * For precise work, use the full EGM2008 model or local geoid.
 */
export function getKenyaGeoidUndulation(location: string): number {
  const key = location.toLowerCase();
  return KENYA_GEOID_UNDULATION[key] ?? KENYA_GEOID_UNDULATION.default;
}

/**
 * Reverse operation: expand ellipsoidal distance to ground distance.
 * Useful for setting out — converting grid/ellipsoidal distances
 * back to ground distances for field work.
 * 
 * d_ground = d_ellipsoid × (R + h) / R
 */
export function expandToGroundDistance(
  ellipsoidalDistance: number,
  heightAboveEllipsoid: number,
  latitude: number = 0
): number {
  const R = computeMeanEarthRadius(latitude);
  return ellipsoidalDistance * (R + heightAboveEllipsoid) / R;
}
