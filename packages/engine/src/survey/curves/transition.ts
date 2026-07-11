/**
 * Transition (Spiral) Curve Calculations
 * 
 * Clothoid spiral transitions between tangents and circular curves.
 * Used for road and railway design to provide smooth transitions
 * from straight to curved alignment.
 * 
 * References:
 * - Schofield, W. (2001) "Engineering Surveying"
 * - AASHTO Green Book
 */

// ─── Types ───────────────────────────────────────────────────────

export interface SpiralCurveInput {
  /** Radius of the circular curve (meters) */
  radius: number;
  /** Design speed (km/h) */
  designSpeed: number;
  /** Rate of change of centripetal acceleration (m/s³), default 0.3 */
  c?: number;
}

export interface SpiralCurveResult {
  /** Radius of circular curve (meters) */
  radius: number;
  /** Spiral length (meters) */
  spiralLength: number;
  /** Spiral angle (decimal degrees) — θs = Ls / (2R) */
  spiralAngle: number;
  /** Tangent shift (p) — offset of circular curve from tangent (meters) */
  p: number;
  /** Tangent extension (k) — distance from TS to shifted PI (meters) */
  k: number;
  /** X coordinate of SC from TS (meters) */
  x: number;
  /** Y coordinate of SC from TS (meters) */
  y: number;
  /** Long chord from TS to SC (meters) */
  longChord: number;
}

// ─── Core Functions ──────────────────────────────────────────────

/**
 * Compute spiral curve parameters.
 * 
 * Uses the clothoid (Euler spiral) approximation formulas.
 * 
 * Spiral length from design criteria:
 *   Ls = V³ / (3.6³ × C × R)
 * 
 * Where:
 *   V = design speed (km/h)
 *   C = rate of change of centripetal acceleration (0.3 m/s³ typical)
 *   R = radius of circular curve
 */
export function computeSpiralCurve(input: SpiralCurveInput): SpiralCurveResult {
  const { radius, designSpeed, c = 0.3 } = input;
  
  // Compute spiral length from design criteria
  const Ls = (designSpeed * designSpeed * designSpeed) / (3.6 * 3.6 * 3.6 * c * radius);
  
  // Spiral angle θs = Ls / (2R) in radians
  const thetaS = Ls / (2 * radius);
  const spiralAngle = thetaS * 180 / Math.PI;
  
  // Approximate coordinates using series expansion (up to 4th order)
  // X = Ls × (1 - θs²/10 + θs⁴/216)
  // Y = Ls × (θs/3 - θs³/42 + θs⁵/1320)
  const thetaS2 = thetaS * thetaS;
  const thetaS3 = thetaS2 * thetaS;
  const thetaS4 = thetaS3 * thetaS;
  const thetaS5 = thetaS4 * thetaS;
  
  const x = Ls * (1 - thetaS2 / 10 + thetaS4 / 216);
  const y = Ls * (thetaS / 3 - thetaS3 / 42 + thetaS5 / 1320);
  
  // Tangent shift and extension
  const p = y - radius * (1 - Math.cos(thetaS));
  const k = x - radius * Math.sin(thetaS);
  
  // Long chord from TS to SC
  const longChord = Math.sqrt(x * x + y * y);
  
  return {
    radius,
    spiralLength: Math.round(Ls * 1000) / 1000,
    spiralAngle: Math.round(spiralAngle * 10000) / 10000,
    p: Math.round(p * 1000) / 1000,
    k: Math.round(k * 1000) / 1000,
    x: Math.round(x * 1000) / 1000,
    y: Math.round(y * 1000) / 1000,
    longChord: Math.round(longChord * 1000) / 1000,
  };
}
