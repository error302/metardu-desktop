/**
 * Projection Convergence Module
 * 
 * Computes the grid convergence (meridian convergence) at a point.
 * Grid convergence is the angle between grid north and true north.
 * 
 * For UTM Zone 37S at 1° from the central meridian:
 *   Convergence ≈ 0° at the equator, increases with latitude
 *   At latitude 1°S, convergence ≈ 1° (significant!)
 * 
 * This affects bearing computations:
 *   Grid bearing = True bearing + convergence
 * 
 * Reference:
 * - Snyder, J.P. (1987) "Map Projections — A Working Manual"
 */

// ─── Types ───────────────────────────────────────────────────────

export interface ConvergenceInput {
  /** Latitude in decimal degrees */
  latitude: number;
  /** Longitude in decimal degrees */
  longitude: number;
  /** Central meridian of the projection zone in decimal degrees */
  centralMeridian: number;
}

export interface ConvergenceResult {
  /** Grid convergence in decimal degrees */
  convergence: number;
  /** Grid convergence in decimal degrees, minutes, seconds */
  convergenceDMS: { degrees: number; minutes: number; seconds: number };
  /** Sign convention: positive = east of central meridian */
  sign: 'E' | 'W' | 'on_meridian';
  /** Magnitude in arc-seconds */
  arcSeconds: number;
  /** Whether convergence exceeds 30 arc-seconds (significant for cadastral) */
  isSignificant: boolean;
}

// ─── Core Functions ──────────────────────────────────────────────

/**
 * Compute grid convergence at a point using the series formula.
 * 
 * γ = (λ - λ₀) × sin(φ) + [(λ - λ₀)³ × sin(φ) × cos²(φ)] / 3 + ...
 * 
 * For most practical purposes, the first term is sufficient.
 * The second term adds < 0.1 arc-second for lines within 3° of CM.
 * 
 * @param input - Convergence computation parameters
 * @returns Convergence result
 */
export function computeConvergence(input: ConvergenceInput): ConvergenceResult {
  const { latitude, longitude, centralMeridian } = input;
  
  const phi = latitude * Math.PI / 180;
  const dLambda = (longitude - centralMeridian) * Math.PI / 180;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  
  // First-order convergence (sufficient for most work)
  let gamma = dLambda * sinPhi;
  
  // Third-order term (for high accuracy near zone edges)
  const dLambda3 = dLambda * dLambda * dLambda;
  gamma += (dLambda3 * sinPhi * cosPhi * cosPhi) / 3;
  
  // Convert to degrees
  const convergenceDeg = gamma * 180 / Math.PI;
  
  // Determine sign
  let sign: 'E' | 'W' | 'on_meridian';
  if (Math.abs(convergenceDeg) < 1e-10) {
    sign = 'on_meridian';
  } else if (convergenceDeg > 0) {
    sign = 'E';
  } else {
    sign = 'W';
  }
  
  // Convert to DMS
  const convergenceDMS = decimalDegreesToDMS(convergenceDeg);
  
  // Arc-seconds
  const arcSeconds = Math.abs(convergenceDeg) * 3600;
  
  return {
    convergence: convergenceDeg,
    convergenceDMS,
    sign,
    arcSeconds: Math.round(arcSeconds * 100) / 100,
    isSignificant: arcSeconds > 30, // 30 arc-seconds threshold for cadastral
  };
}

/**
 * Convert grid bearing to true (astronomic) bearing.
 * 
 * True bearing = Grid bearing - convergence
 * (Convention: convergence positive east of CM)
 * 
 * @param gridBearing - Grid bearing in decimal degrees
 * @param convergence - Grid convergence in decimal degrees
 * @returns True bearing in decimal degrees
 */
export function gridBearingToTrue(gridBearing: number, convergence: number): number {
  return normalizeBearing(gridBearing - convergence);
}

/**
 * Convert true (astronomic) bearing to grid bearing.
 * 
 * Grid bearing = True bearing + convergence
 * 
 * @param trueBearing - True bearing in decimal degrees
 * @param convergence - Grid convergence in decimal degrees
 * @returns Grid bearing in decimal degrees
 */
export function trueBearingToGrid(trueBearing: number, convergence: number): number {
  return normalizeBearing(trueBearing + convergence);
}

/**
 * Apply convergence correction to a bearing.
 * Synonym for trueBearingToGrid (more descriptive in pipeline context).
 */
export function applyConvergenceToBearing(
  trueBearing: number,
  convergence: number
): number {
  return trueBearingToGrid(trueBearing, convergence);
}

// ─── Utility Functions ───────────────────────────────────────────

/**
 * Convert decimal degrees to degrees, minutes, seconds.
 */
function decimalDegreesToDMS(dd: number): { degrees: number; minutes: number; seconds: number } {
  const absDD = Math.abs(dd);
  const degrees = Math.floor(absDD);
  const minutesDecimal = (absDD - degrees) * 60;
  const minutes = Math.floor(minutesDecimal);
  const seconds = (minutesDecimal - minutes) * 60;
  
  return {
    degrees: dd < 0 ? -degrees : degrees,
    minutes,
    seconds: Math.round(seconds * 100) / 100,
  };
}

/**
 * Normalize bearing to 0-360° range.
 */
function normalizeBearing(bearing: number): number {
  let result = bearing % 360;
  if (result < 0) result += 360;
  return result;
}
