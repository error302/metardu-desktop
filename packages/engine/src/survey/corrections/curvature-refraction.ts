/**
 * Curvature & Refraction Correction Module
 * 
 * Corrects height differences for Earth curvature and atmospheric refraction.
 * Without this correction, a 1km sight line has 67.5mm vertical error.
 * 
 * For Kenya's latitude (~0-1°S), the Earth radius is approximately 6378 km
 * (close to the equatorial radius since Kenya straddles the equator).
 * 
 * Reference:
 * - Bomford, G. (1980) "Geodesy" 4th edition
 * - Clark, D. (1975) "Plane and Geodetic Surveying"
 */

// ─── Constants ───────────────────────────────────────────────────

/** WGS84 semi-major axis (equatorial radius) in meters */
export const WGS84_A = 6378137.0;

/** WGS84 semi-minor axis (polar radius) in meters */
export const WGS84_B = 6356752.314245;

/** WGS84 first eccentricity squared */
export const WGS84_E2 = 0.00669437999014;

/** Default refraction coefficient for Kenya (tropical, daytime) */
export const KENYA_REFRACTION_COEFFICIENT = 0.13;

/** Default refraction coefficient for temperate regions */
export const TEMPERATE_REFRACTION_COEFFICIENT = 0.14;

// ─── Types ───────────────────────────────────────────────────────

export interface CurvatureRefractionInput {
  /** Slope distance in meters */
  slopeDistance: number;
  /** Vertical angle (zenith distance) in decimal degrees 
   *  90° = horizontal, >90° = upward, <90° = downward */
  verticalAngle: number;
  /** Instrument height in meters (above station mark) */
  instrumentHeight: number;
  /** Target height in meters (above station mark) */
  targetHeight: number;
  /** Latitude in decimal degrees (for Earth radius computation) */
  latitude?: number;
  /** Refraction coefficient (default: 0.13 for Kenya) */
  refractionCoefficient?: number;
}

export interface CurvatureRefractionResult {
  /** Horizontal distance (meters) — from slope reduction */
  horizontalDistance: number;
  /** Height difference before C&R correction (meters) */
  rawHeightDifference: number;
  /** Height difference after C&R correction (meters) */
  correctedHeightDifference: number;
  /** Curvature & refraction correction (meters) */
  crCorrection: number;
  /** Curvature component alone (meters) */
  curvatureComponent: number;
  /** Refraction component alone (meters) */
  refractionComponent: number;
  /** Earth radius used (meters) */
  earthRadius: number;
  /** Refraction coefficient used */
  refractionCoefficient: number;
  /** Whether C&R correction exceeds 10mm (significant) */
  isSignificant: boolean;
  /** Warning if correction is large */
  warning?: string;
}

// ─── Core Functions ──────────────────────────────────────────────

/**
 * Compute mean radius of curvature of the Earth at a given latitude.
 * Uses the WGS84 ellipsoid parameters.
 * 
 * Rm = √(ρ × ν)
 * 
 * Where:
 *   ρ = a(1 - e²) / (1 - e² × sin²(φ))^(3/2)  (meridional radius)
 *   ν = a / √(1 - e² × sin²(φ))                 (prime vertical radius)
 * 
 * @param latitude - Latitude in decimal degrees
 * @returns Mean radius of curvature in meters
 */
export function computeMeanEarthRadius(latitude: number): number {
  const phi = latitude * Math.PI / 180;
  const sinPhi = Math.sin(phi);
  const sinPhi2 = sinPhi * sinPhi;
  
  // Meridional radius of curvature
  const rho = (WGS84_A * (1 - WGS84_E2)) / 
    Math.pow(1 - WGS84_E2 * sinPhi2, 1.5);
  
  // Radius of curvature in the prime vertical
  const nu = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi2);
  
  // Mean radius (geometric mean of ρ and ν)
  return Math.sqrt(rho * nu);
}

/**
 * Compute curvature & refraction correction.
 * 
 * C&R = (1 - k) / (2R) × D²
 * 
 * Where:
 *   k = refraction coefficient (0.13 for Kenya daytime)
 *   R = mean Earth radius at latitude
 *   D = horizontal distance in meters
 * 
 * For Kenya (latitude ~0°, k=0.13):
 *   C&R ≈ 0.0675 × D² (D in km, result in meters)
 * 
 * @param horizontalDistance - Horizontal distance in meters
 * @param latitude - Latitude in decimal degrees (default: 0 = equator)
 * @param refractionCoefficient - Refraction coefficient (default: 0.13 Kenya)
 * @returns C&R correction in meters (always positive — adds to height)
 */
export function computeCRCorrection(
  horizontalDistance: number,
  latitude: number = 0,
  refractionCoefficient: number = KENYA_REFRACTION_COEFFICIENT
): number {
  const R = computeMeanEarthRadius(latitude);
  const D = horizontalDistance;
  
  const crCorrection = (1 - refractionCoefficient) / (2 * R) * D * D;
  
  return crCorrection;
}

/**
 * Apply curvature & refraction correction to a vertical observation.
 * 
 * Full height difference computation:
 *   ΔH = SD × cos(VA) + (ih - th) + C&R
 * 
 * Or equivalently using zenith distance:
 *   ΔH = SD × cos(ZD) + (ih - th) + (1-k)/(2R) × D²
 * 
 * @param input - Observation parameters
 * @returns Full C&R correction result
 */
export function applyCurvatureRefractionCorrection(
  input: CurvatureRefractionInput
): CurvatureRefractionResult {
  const {
    slopeDistance,
    verticalAngle,
    instrumentHeight,
    targetHeight,
    latitude = 0,
    refractionCoefficient = KENYA_REFRACTION_COEFFICIENT,
  } = input;
  
  // Validate
  if (slopeDistance <= 0) {
    throw new Error(`Slope distance must be positive, got ${slopeDistance}`);
  }
  if (verticalAngle < 0 || verticalAngle > 180) {
    throw new Error(`Vertical angle must be 0-180°, got ${verticalAngle}`);
  }
  if (refractionCoefficient < 0 || refractionCoefficient > 0.5) {
    throw new Error(`Refraction coefficient ${refractionCoefficient} is outside valid range (0-0.5)`);
  }
  
  const R = computeMeanEarthRadius(latitude);
  const vaRad = verticalAngle * Math.PI / 180;
  
  // Compute horizontal distance from slope distance and vertical angle
  const horizontalDistance = slopeDistance * Math.sin(vaRad);
  
  // Raw height difference (without C&R)
  const rawHeightDifference = slopeDistance * Math.cos(vaRad) + 
    (instrumentHeight - targetHeight);
  
  // Curvature component: D² / (2R)
  const curvatureComponent = (horizontalDistance * horizontalDistance) / (2 * R);
  
  // Refraction component: k × D² / (2R)
  const refractionComponent = refractionCoefficient * curvatureComponent;
  
  // Combined C&R correction
  const crCorrection = curvatureComponent - refractionComponent;
  
  // Corrected height difference
  const correctedHeightDifference = rawHeightDifference + crCorrection;
  
  // Significance check
  const isSignificant = crCorrection > 0.010; // 10mm threshold
  const warning = crCorrection > 0.010
    ? `C&R correction of ${(crCorrection * 1000).toFixed(1)}mm exceeds 10mm threshold for distance ${(horizontalDistance).toFixed(0)}m`
    : undefined;
  
  return {
    horizontalDistance,
    rawHeightDifference,
    correctedHeightDifference,
    crCorrection,
    curvatureComponent,
    refractionComponent,
    earthRadius: R,
    refractionCoefficient,
    isSignificant,
    warning,
  };
}

/**
 * Quick C&R correction — returns just the correction in meters.
 * Useful for checking if C&R is significant before full computation.
 */
export function quickCRCorrection(
  horizontalDistance: number,
  latitude: number = 0
): number {
  return computeCRCorrection(horizontalDistance, latitude);
}

/**
 * Estimate the maximum distance where C&R correction is negligible
 * (below a given threshold).
 * 
 * @param thresholdMm - Threshold in millimeters (default: 10mm)
 * @param latitude - Latitude for Earth radius
 * @param refractionCoefficient - Refraction coefficient
 * @returns Maximum distance in meters where C&R < threshold
 */
export function maxDistanceWithoutCR(
  thresholdMm: number = 10,
  latitude: number = 0,
  refractionCoefficient: number = KENYA_REFRACTION_COEFFICIENT
): number {
  const R = computeMeanEarthRadius(latitude);
  const thresholdM = thresholdMm / 1000;
  
  // D² = threshold × 2R / (1 - k)
  const D = Math.sqrt(thresholdM * 2 * R / (1 - refractionCoefficient));
  
  return D;
}
