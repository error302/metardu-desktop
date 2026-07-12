/**
 * Covariance Propagation — WithUncertainty<T> wrapper
 *
 * PROBLEM
 * -------
 * Throughout METARDU, computations produce point values without uncertainty:
 *   - A deed plan area is reported as "0.1234 ha" — but what's the CI?
 *   - A coordinate is reported as (500000.123, 9900000.456) — but ± what?
 *   - A distance is reported as 142.567m — but what's the standard error?
 *
 * For statutory submissions, this is a legal gap. If a boundary dispute
 * comes down to 0.5m², the surveyor needs to say "the area is 1234.5 ± 0.2 m²"
 * — not just "1234.5 m²." Without the CI, the surveyor can't defend the
 * result in court.
 *
 * SOLUTION
 * --------
 * A `WithUncertainty<T>` wrapper type that carries a covariance matrix
 * alongside every value. Arithmetic operations propagate the covariance
 * using the law of variance propagation:
 *
 *   Var(f(x)) = J·Σ_x·J^T
 *
 * where J = ∂f/∂x is the Jacobian of f at x, and Σ_x is the covariance
 * matrix of x.
 *
 * This module provides:
 *   1. The `WithUncertainty<T>` type (value + covariance)
 *   2. Constructors for scalar, vector, and coordinate values
 *   3. Arithmetic operations (add, subtract, multiply, divide) with
 *      automatic covariance propagation
 *   4. A `propagate` function for applying arbitrary functions with
 *      numerical Jacobian computation
 *   5. Specialized operations for surveying:
 *      - distance (with covariance propagation)
 *      - area of polygon (with covariance propagation)
 *      - coordinate transformation (with covariance propagation)
 *
 * REFERENCES
 * ----------
 * - Bevington, P.R. & Robinson, D.K. (2003). Data Reduction and Error
 *   Analysis, 3rd ed. McGraw-Hill, Chapter 3.
 * - Ghilani, C.D. (2017). Adjustment Computations, 6th ed. Wiley, §13.
 * - Mikhail, E.M. (1976). Observations and Least Squares. University Press
 *   of America.
 */

// ─── Core Type ──────────────────────────────────────────────────────────────

/**
 * A value of type T with an associated covariance matrix.
 *
 * For scalar T: covariance is a 1×1 matrix [var]
 * For vector T (length n): covariance is an n×n matrix
 * For coordinate T (E, N, H): covariance is a 3×3 matrix
 */
export interface WithUncertainty<T> {
  /** The value */
  value: T
  /** Covariance matrix (n×n for n-dimensional value) */
  covariance: number[][]
  /** Optional: human-readable provenance (where the uncertainty came from) */
  provenance?: string
  /** Optional: confidence level for the CI (default 0.95) */
  confidenceLevel?: number
}

// ─── Constructors ───────────────────────────────────────────────────────────

/**
 * Create a scalar with uncertainty.
 *
 * @param value - The scalar value
 * @param stdDev - Standard deviation (1σ)
 * @param provenance - Optional provenance string
 */
export function scalar(
  value: number,
  stdDev: number,
  provenance?: string,
): WithUncertainty<number> {
  return {
    value,
    covariance: [[stdDev * stdDev]],
    provenance,
  }
}

/**
 * Create a vector with uncertainty.
 *
 * @param values - The vector values
 * @param covariance - Covariance matrix (n×n)
 * @param provenance - Optional provenance string
 */
export function vector(
  values: number[],
  covariance: number[][],
  provenance?: string,
): WithUncertainty<number[]> {
  return {
    value: values,
    covariance,
    provenance,
  }
}

/**
 * Create a 2D coordinate (E, N) with uncertainty.
 *
 * @param easting - Easting
 * @param northing - Northing
 * @param sigmaE - Standard deviation in E
 * @param sigmaN - Standard deviation in N
 * @param sigmaEN - E-N covariance (default 0 = uncorrelated)
 */
export function coordinate2D(
  easting: number,
  northing: number,
  sigmaE: number,
  sigmaN: number,
  sigmaEN: number = 0,
  provenance?: string,
): WithUncertainty<{ e: number; n: number }> {
  return {
    value: { e: easting, n: northing },
    covariance: [
      [sigmaE * sigmaE, sigmaEN],
      [sigmaEN, sigmaN * sigmaN],
    ],
    provenance,
  }
}

/**
 * Create a 3D coordinate (E, N, H) with uncertainty.
 */
export function coordinate3D(
  easting: number,
  northing: number,
  elevation: number,
  sigmaE: number,
  sigmaN: number,
  sigmaH: number,
  covariances: { en?: number; eh?: number; nh?: number } = {},
  provenance?: string,
): WithUncertainty<{ e: number; n: number; h: number }> {
  const { en = 0, eh = 0, nh = 0 } = covariances
  return {
    value: { e: easting, n: northing, h: elevation },
    covariance: [
      [sigmaE * sigmaE, en, eh],
      [en, sigmaN * sigmaN, nh],
      [eh, nh, sigmaH * sigmaH],
    ],
    provenance,
  }
}

/**
 * Create a value with zero uncertainty (e.g., a defined constant).
 */
export function certain<T>(value: T, dimensions: number): WithUncertainty<T> {
  const zero = Array.from({ length: dimensions }, () => new Array(dimensions).fill(0))
  if (typeof value === 'number') {
    return { value, covariance: [[0]] }
  }
  return { value, covariance: zero }
}

// ─── Confidence Interval Computation ────────────────────────────────────────

/**
 * Compute a confidence interval for a scalar WithUncertainty.
 *
 * @param value - The uncertain scalar
 * @param confidenceLevel - Confidence level (default 0.95 = 95% CI)
 * @returns { lower, upper, mean, stdDev, halfWidth }
 */
export function scalarCI(
  value: WithUncertainty<number>,
  confidenceLevel: number = 0.95,
): {
  mean: number
  stdDev: number
  halfWidth: number
  lower: number
  upper: number
  confidenceLevel: number
} {
  const variance = value.covariance[0][0]
  const stdDev = Math.sqrt(Math.max(0, variance))

  // z-score for the confidence level (two-tailed)
  // 90% → 1.645, 95% → 1.960, 99% → 2.576
  const z = inverseNormalCDF(1 - (1 - confidenceLevel) / 2)
  const halfWidth = z * stdDev

  return {
    mean: value.value,
    stdDev,
    halfWidth,
    lower: value.value - halfWidth,
    upper: value.value + halfWidth,
    confidenceLevel,
  }
}

/**
 * Format a scalar WithUncertainty for display.
 * Example: "1234.5 ± 0.2 m² (95% CI)"
 */
export function formatScalarWithCI(
  value: WithUncertainty<number>,
  options: { unit?: string; decimals?: number; confidenceLevel?: number } = {},
): string {
  const { unit = '', decimals = 3, confidenceLevel = 0.95 } = options
  const ci = scalarCI(value, confidenceLevel)
  const pct = Math.round(confidenceLevel * 100)
  return `${ci.mean.toFixed(decimals)} ± ${ci.halfWidth.toFixed(decimals)}${unit ? ' ' + unit : ''} (${pct}% CI)`
}

// ─── Arithmetic Operations (Scalar) ─────────────────────────────────────────

/**
 * Add two uncertain scalars. Variances add (assuming independence).
 *
 * If correlated, provide the cross-covariance.
 */
export function addScalars(
  a: WithUncertainty<number>,
  b: WithUncertainty<number>,
  covAB: number = 0,
): WithUncertainty<number> {
  return {
    value: a.value + b.value,
    covariance: [[a.covariance[0][0] + b.covariance[0][0] + 2 * covAB]],
    provenance: `add(${a.provenance || '?'}, ${b.provenance || '?'})`,
  }
}

/**
 * Subtract two uncertain scalars.
 */
export function subtractScalars(
  a: WithUncertainty<number>,
  b: WithUncertainty<number>,
  covAB: number = 0,
): WithUncertainty<number> {
  return {
    value: a.value - b.value,
    covariance: [[a.covariance[0][0] + b.covariance[0][0] - 2 * covAB]],
    provenance: `subtract(${a.provenance || '?'}, ${b.provenance || '?'})`,
  }
}

/**
 * Multiply two uncertain scalars.
 *
 * For f(x,y) = x·y:
 *   ∂f/∂x = y,  ∂f/∂y = x
 *   Var(f) = y²·Var(x) + x²·Var(y) + 2·x·y·Cov(x,y)
 */
export function multiplyScalars(
  a: WithUncertainty<number>,
  b: WithUncertainty<number>,
  covAB: number = 0,
): WithUncertainty<number> {
  const aVal = a.value
  const bVal = b.value
  const varA = a.covariance[0][0]
  const varB = b.covariance[0][0]

  return {
    value: aVal * bVal,
    covariance: [[bVal * bVal * varA + aVal * aVal * varB + 2 * aVal * bVal * covAB]],
    provenance: `multiply(${a.provenance || '?'}, ${b.provenance || '?'})`,
  }
}

/**
 * Divide two uncertain scalars.
 *
 * For f(x,y) = x/y:
 *   ∂f/∂x = 1/y,  ∂f/∂y = -x/y²
 *   Var(f) = Var(x)/y² + x²·Var(y)/y⁴ - 2·x·Cov(x,y)/y³
 */
export function divideScalars(
  a: WithUncertainty<number>,
  b: WithUncertainty<number>,
  covAB: number = 0,
): WithUncertainty<number> {
  const aVal = a.value
  const bVal = b.value
  const varA = a.covariance[0][0]
  const varB = b.covariance[0][0]

  return {
    value: aVal / bVal,
    covariance: [[varA / (bVal * bVal) + aVal * aVal * varB / (bVal ** 4) - 2 * aVal * covAB / (bVal ** 3)]],
    provenance: `divide(${a.provenance || '?'}, ${b.provenance || '?'})`,
  }
}

// ─── Generic Propagation ────────────────────────────────────────────────────

/**
 * Propagate uncertainty through an arbitrary function using numerical Jacobian.
 *
 * For f: R^n → R^m, the Jacobian J is m×n.
 * The output covariance is J · Σ_x · J^T (m×m).
 *
 * @param inputs - Input value with covariance (n-dim)
 * @param fn - Function from R^n → R^m
 * @param outputDim - Output dimension m
 * @param stepSize - Step size for numerical differentiation (default 1e-7)
 */
export function propagate<T extends number[]>(
  input: WithUncertainty<T>,
  fn: (x: T) => number[],
  outputDim: number,
  stepSize: number = 1e-7,
): WithUncertainty<number[]> {
  const x = input.value
  const n = x.length

  // Evaluate f at the nominal point
  const fx = fn(x)

  // Compute Jacobian (m×n) using central difference
  const J: number[][] = Array(outputDim).fill(null).map(() => new Array(n).fill(0))
  for (let j = 0; j < n; j++) {
    const xPlus = [...x] as T
    const xMinus = [...x] as T
    xPlus[j] += stepSize
    xMinus[j] -= stepSize
    const fPlus = fn(xPlus)
    const fMinus = fn(xMinus)
    for (let i = 0; i < outputDim; i++) {
      J[i][j] = (fPlus[i] - fMinus[i]) / (2 * stepSize)
    }
  }

  // Compute output covariance: J · Σ · J^T
  const JSigma = matMul(J, input.covariance)  // m×n
  const outputCov = matMul(JSigma, transpose(J))  // m×m

  return {
    value: fx,
    covariance: outputCov,
    provenance: `propagate(${input.provenance || '?'})`,
  }
}

// ─── Surveying-Specific Operations ──────────────────────────────────────────

/**
 * Compute the distance between two uncertain 2D coordinates.
 *
 * For f(E1, N1, E2, N2) = √((E2-E1)² + (N2-N1)²):
 *   ∂f/∂E1 = -(E2-E1)/d
 *   ∂f/∂N1 = -(N2-N1)/d
 *   ∂f/∂E2 = (E2-E1)/d
 *   ∂f/∂N2 = (N2-N1)/d
 *
 * The input is a 4D vector (E1, N1, E2, N2) with a 4×4 covariance matrix.
 *
 * @param p1 - First coordinate (with 2×2 covariance)
 * @param p2 - Second coordinate (with 2×2 covariance)
 * @param cov12 - Optional 2×2 cross-covariance between p1 and p2 (default zero)
 */
export function distance2D(
  p1: WithUncertainty<{ e: number; n: number }>,
  p2: WithUncertainty<{ e: number; n: number }>,
  cov12: number[][] = [[0, 0], [0, 0]],
): WithUncertainty<number> {
  const dE = p2.value.e - p1.value.e
  const dN = p2.value.n - p1.value.n
  const d = Math.sqrt(dE * dE + dN * dN)

  // Build 4×4 covariance matrix
  const Sigma: number[][] = [
    [p1.covariance[0][0], p1.covariance[0][1], cov12[0][0], cov12[0][1]],
    [p1.covariance[1][0], p1.covariance[1][1], cov12[1][0], cov12[1][1]],
    [cov12[0][0], cov12[1][0], p2.covariance[0][0], p2.covariance[0][1]],
    [cov12[0][1], cov12[1][1], p2.covariance[1][0], p2.covariance[1][1]],
  ]

  // Jacobian: ∂d/∂(E1, N1, E2, N2)
  let J: number[]
  if (d > 1e-15) {
    J = [-dE / d, -dN / d, dE / d, dN / d]
  } else {
    J = [0, 0, 0, 0]
  }

  // Variance: J · Σ · J^T (scalar for scalar output)
  let variance = 0
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      variance += J[i] * Sigma[i][j] * J[j]
    }
  }

  return {
    value: d,
    covariance: [[variance]],
    provenance: `distance2D(${p1.provenance || '?'}, ${p2.provenance || '?'})`,
  }
}

/**
 * Compute the area of an uncertain polygon using the shoelace formula.
 *
 * For a polygon with vertices (E_1, N_1), ..., (E_n, N_n):
 *   A = (1/2) |Σ (E_i · N_{i+1} - E_{i+1} · N_i)|
 *
 * The variance of A is computed via the Jacobian:
 *   ∂A/∂E_i = (1/2)(N_{i+1} - N_{i-1}) (with cyclic indices)
 *   ∂A/∂N_i = (1/2)(E_{i-1} - E_{i+1})
 *
 * @param vertices - Array of uncertain 2D coordinates
 * @param crossCovariances - Optional cross-covariances between vertices (default zero)
 */
export function polygonArea2D(
  vertices: WithUncertainty<{ e: number; n: number }>[],
  crossCovariances?: Map<string, number[][]>,
): WithUncertainty<number> {
  const n = vertices.length
  if (n < 3) {
    return { value: 0, covariance: [[0]] }
  }

  // Compute area using shoelace
  let area = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += vertices[i].value.e * vertices[j].value.n
    area -= vertices[j].value.e * vertices[i].value.n
  }
  area = Math.abs(area) / 2

  // Build full 2n×2n covariance matrix
  // Ordering: [E1, N1, E2, N2, ..., En, Nn]
  const Sigma: number[][] = Array(2 * n).fill(null).map(() => new Array(2 * n).fill(0))

  for (let i = 0; i < n; i++) {
    Sigma[2 * i][2 * i] = vertices[i].covariance[0][0]
    Sigma[2 * i][2 * i + 1] = vertices[i].covariance[0][1]
    Sigma[2 * i + 1][2 * i] = vertices[i].covariance[1][0]
    Sigma[2 * i + 1][2 * i + 1] = vertices[i].covariance[1][1]
  }

  // Add cross-covariances if provided
  if (crossCovariances) {
    for (const [key, cov] of crossCovariances) {
      const [i, j] = key.split('-').map(Number)
      Sigma[2 * i][2 * j] = cov[0][0]
      Sigma[2 * i][2 * j + 1] = cov[0][1]
      Sigma[2 * i + 1][2 * j] = cov[1][0]
      Sigma[2 * i + 1][2 * j + 1] = cov[1][1]
      // Symmetric
      Sigma[2 * j][2 * i] = cov[0][0]
      Sigma[2 * j][2 * i + 1] = cov[1][0]
      Sigma[2 * j + 1][2 * i] = cov[0][1]
      Sigma[2 * j + 1][2 * i + 1] = cov[1][1]
    }
  }

  // Compute Jacobian: ∂A/∂(E1, N1, ..., En, Nn)
  // ∂A/∂E_i = (1/2)·sign·(N_{i+1} - N_{i-1})
  // ∂A/∂N_i = (1/2)·sign·(E_{i-1} - E_{i+1})
  // where sign = +1 if the polygon is CCW, -1 if CW
  // We've already taken abs(), so we need to determine the sign separately
  let signedArea = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    signedArea += vertices[i].value.e * vertices[j].value.n
    signedArea -= vertices[j].value.e * vertices[i].value.n
  }
  signedArea = signedArea / 2
  const sign = signedArea >= 0 ? 1 : -1

  const J = new Array(2 * n).fill(0)
  for (let i = 0; i < n; i++) {
    const iPlus = (i + 1) % n
    const iMinus = (i - 1 + n) % n
    J[2 * i] = 0.5 * sign * (vertices[iPlus].value.n - vertices[iMinus].value.n)  // ∂A/∂E_i
    J[2 * i + 1] = 0.5 * sign * (vertices[iMinus].value.e - vertices[iPlus].value.e)  // ∂A/∂N_i
  }

  // Variance: J · Σ · J^T (scalar)
  let variance = 0
  for (let i = 0; i < 2 * n; i++) {
    for (let j = 0; j < 2 * n; j++) {
      variance += J[i] * Sigma[i][j] * J[j]
    }
  }

  return {
    value: area,
    covariance: [[variance]],
    provenance: `polygonArea2D(${n} vertices)`,
  }
}

/**
 * Compute the perimeter of an uncertain polygon.
 */
export function polygonPerimeter2D(
  vertices: WithUncertainty<{ e: number; n: number }>[],
): WithUncertainty<number> {
  let totalLength = 0
  let totalVariance = 0

  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length
    const dist = distance2D(vertices[i], vertices[j])
    totalLength += dist.value
    totalVariance += dist.covariance[0][0]
  }

  return {
    value: totalLength,
    covariance: [[totalVariance]],
    provenance: `polygonPerimeter2D(${vertices.length} vertices)`,
  }
}

// ─── Matrix Helpers ─────────────────────────────────────────────────────────

function matMul(A: number[][], B: number[][]): number[][] {
  const rows = A.length
  const cols = B[0].length
  const inner = B.length
  const result: number[][] = Array(rows).fill(null).map(() => Array(cols).fill(0))
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      let sum = 0
      for (let k = 0; k < inner; k++) {
        sum += A[i][k] * B[k][j]
      }
      result[i][j] = sum
    }
  }
  return result
}

function transpose(A: number[][]): number[][] {
  const rows = A.length
  const cols = A[0].length
  const result: number[][] = Array(cols).fill(null).map(() => Array(rows).fill(0))
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      result[j][i] = A[i][j]
    }
  }
  return result
}

/**
 * Inverse standard normal CDF (Acklam's algorithm).
 * Same implementation as in lsaStatisticalTesting.ts.
 */
function inverseNormalCDF(p: number): number {
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity

  const a = [
    -3.969683028665376e+01, 2.209460984245205e+02,
    -2.759285104469687e+02, 1.383577518672690e+02,
    -3.066479806614716e+01, 2.506628277459239e+00,
  ]
  const b = [
    -5.447609879822406e+01, 1.615858368580409e+02,
    -1.556989798598866e+02, 6.680131188771972e+01,
    -1.328068155288572e+01,
  ]
  const c = [
    -7.784894002430293e-03, -3.223964580411365e-01,
    -2.400758277161838e+00, -2.549732539343734e+00,
    4.374664141464968e+00, 2.938163982698783e+00,
  ]
  const d = [
    7.784695709041462e-03, 3.224671290700398e-01,
    2.445134137142996e+00, 3.754408661907416e+00,
  ]

  const pLow = 0.02425
  const pHigh = 1 - pLow

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  } else if (p <= pHigh) {
    const q = p - 0.5
    const r = q * q
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
}
