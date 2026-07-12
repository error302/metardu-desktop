/**
 * @module errorEllipse
 *
 * Error ellipse computation for adjusted survey coordinates.
 *
 * After a least squares adjustment, each adjusted coordinate has an
 * uncertainty that depends on the observation quality and network geometry.
 * The error ellipse visualizes this uncertainty — a small ellipse means
 * high confidence, a large ellipse means low confidence.
 *
 * The ellipse is defined by:
 *   - Semi-major axis (a) — the largest probable error direction
 *   - Semi-minor axis (b) — the smallest probable error direction
 *   - Orientation (θ) — rotation of the major axis from easting
 *
 * References:
 *   - "Adjustment Computations" by Ghilani, Chapter 6
 *   - "Elementary Surveying" by Ghilani & Wolf, 16th Ed., Chapter 16
 */

export interface ErrorEllipse {
  /** Semi-major axis in metres (at the given confidence level) */
  semiMajor: number
  /** Semi-minor axis in metres */
  semiMinor: number
  /** Orientation of the major axis in decimal degrees (0° = East, 90° = North) */
  orientation: number
  /** Confidence level (e.g., 0.95 for 95% confidence) */
  confidenceLevel: number
  /** The multiplier used (e.g., 2.45 for 95% with 2 DOF) */
  multiplier: number
}

/**
 * Compute a standard error ellipse from a 2×2 covariance matrix.
 *
 * The covariance matrix for a point (E, N) is:
 *   | σ_EE  σ_EN |
 *   | σ_NE  σ_NN |
 *
 * where σ_EE = variance of easting, σ_NN = variance of northing,
 * and σ_EN = covariance between easting and northing.
 *
 * @param sigmaEE Variance of easting (m²)
 * @param sigmaNN Variance of northing (m²)
 * @param sigmaEN Covariance of easting/northing (m²)
 * @param confidenceLevel Desired confidence level (default: 0.95)
 */
export function computeErrorEllipse(
  sigmaEE: number,
  sigmaNN: number,
  sigmaEN: number,
  confidenceLevel: number = 0.95,
): ErrorEllipse {
  // Eigenvalues of the covariance matrix
  // λ = (σ_EE + σ_NN)/2 ± sqrt(((σ_EE - σ_NN)/2)² + σ_EN²)
  const mean = (sigmaEE + sigmaNN) / 2
  const diff = (sigmaEE - sigmaNN) / 2
  const discriminant = Math.sqrt(diff * diff + sigmaEN * sigmaEN)

  const lambda1 = mean + discriminant // larger eigenvalue
  const lambda2 = mean - discriminant // smaller eigenvalue

  // Semi-axes = sqrt(eigenvalue) × multiplier
  // The multiplier depends on the confidence level and degrees of freedom (2)
  const multiplier = getChiSquareMultiplier(confidenceLevel, 2)

  const semiMajor = Math.sqrt(Math.max(0, lambda1)) * multiplier
  const semiMinor = Math.sqrt(Math.max(0, lambda2)) * multiplier

  // Orientation: angle of the eigenvector corresponding to lambda1
  // tan(2θ) = 2·σ_EN / (σ_EE - σ_NN)
  let orientation: number
  if (Math.abs(sigmaEE - sigmaNN) < 1e-12) {
    orientation = sigmaEN > 0 ? 45 : -45
  } else {
    orientation = (Math.atan2(2 * sigmaEN, sigmaEE - sigmaNN) * 180 / Math.PI) / 2
  }

  // Normalize to 0-180°
  if (orientation < 0) orientation += 180

  return {
    semiMajor,
    semiMinor,
    orientation,
    confidenceLevel,
    multiplier,
  }
}

/**
 * Get the chi-square multiplier for a given confidence level and
 * degrees of freedom.
 *
 * For a 2-DOF error ellipse (E + N), the multiplier is the square root
 * of the chi-square critical value at (1 - α) with 2 DOF.
 *
 * Common values:
 *   39.4% (1σ):   multiplier = 1.00
 *   63.2%:        multiplier = 1.41 (√2)
 *   86.5%:        multiplier = 2.00
 *   95.0%:        multiplier = 2.45 (√5.99)
 *   99.0%:        multiplier = 3.03 (√9.21)
 */
function getChiSquareMultiplier(confidence: number, dof: number): number {
  // Pre-computed values for 2 DOF (most common case)
  if (dof === 2) {
    if (Math.abs(confidence - 0.394) < 0.01) return 1.00
    if (Math.abs(confidence - 0.632) < 0.01) return 1.414
    if (Math.abs(confidence - 0.865) < 0.01) return 2.00
    if (Math.abs(confidence - 0.95) < 0.01) return 2.447
    if (Math.abs(confidence - 0.99) < 0.01) return 3.035
  }

  // Wilson-Hilferty approximation for general case
  const h = inverseNormalCdf(1 - (1 - confidence) / 2)
  const c = dof * (1 - 2 / (9 * dof) + h * Math.sqrt(2 / (9 * dof))) ** 3
  return Math.sqrt(Math.max(0, c))
}

/**
 * Inverse normal CDF (Acklam's algorithm — same as in realTimeQC.ts).
 */
function inverseNormalCdf(p: number): number {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01]
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]
  const pLow = 0.02425
  const pHigh = 1 - pLow
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
  } else if (p <= pHigh) {
    const q = p - 0.5
    const r = q * q
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)
  } else {
    const q = Math.sqrt(-2 * Math.log(1-p))
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
  }
}

/**
 * Generate SVG path data for drawing an error ellipse on the map.
 *
 * @param centerX, centerY — center of the ellipse (in map coordinates)
 * @param ellipse — the error ellipse parameters
 * @returns SVG path "d" attribute
 */
export function errorEllipseToSvgPath(
  centerX: number,
  centerY: number,
  ellipse: ErrorEllipse,
): string {
  const segments = 64
  const points: string[] = []
  const orientationRad = (ellipse.orientation * Math.PI) / 180

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI
    // Point on ellipse before rotation
    const x = ellipse.semiMajor * Math.cos(angle)
    const y = ellipse.semiMinor * Math.sin(angle)
    // Rotate by orientation
    const rx = x * Math.cos(orientationRad) - y * Math.sin(orientationRad)
    const ry = x * Math.sin(orientationRad) + y * Math.cos(orientationRad)
    // Translate to center
    points.push(`${centerX + rx},${centerY + ry}`)
  }

  return `M ${points.join(' L ')} Z`
}

/**
 * Format an error ellipse for display.
 */
export function formatErrorEllipse(ellipse: ErrorEllipse): string {
  return `±${ellipse.semiMajor.toFixed(3)}m × ±${ellipse.semiMinor.toFixed(3)}m @ ${ellipse.orientation.toFixed(1)}° (${(ellipse.confidenceLevel * 100).toFixed(0)}% confidence)`
}
