/**
 * LSA Statistical Testing — formal hypothesis tests for least-squares adjustments
 *
 * PROBLEM
 * -------
 * The existing adjustNetwork() computes sigmaZero, residuals, and error
 * ellipses, but it doesn't do the formal statistical tests that a boundary
 * commission requires:
 *   1. Global chi-square test — is the adjustment as a whole valid?
 *   2. Baarda's w-test (data snooping) — detect individual blunders
 *   3. Reliability analysis — what's the smallest blunder we can detect?
 *
 * Without these, an adjustment that says "sigmaZero = 1.2" doesn't tell
 * a surveyor whether to trust it. With these, they get: "Global test passed
 * at 95% confidence, no blunders detected, minimal detectable bias = 2.1cm."
 *
 * MATHEMATICAL FOUNDATION
 * -----------------------
 * All formulas follow Baarda (1968) "A Testing Procedure for Use in
 * Geodetic Networks" and Cooper (1987) "Control Surveys in Civil Engineering."
 *
 * References:
 * - Baarda, W. (1968). A Testing Procedure for Use in Geodetic Networks.
 *   Netherlands Geodetic Commission, Publication on Geodesy, Vol 2, No 5.
 * - Cooper, M.A.R. (1987). Control Surveys in Civil Engineering. Granada.
 * - Ghilani, C.D. (2017). Adjustment Computations, 6th ed. Wiley.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChiSquareTestResult {
  /** Whether the global test passed at the chosen confidence level */
  passed: boolean
  /** Observed chi-square statistic = v^T P v = dof * σ₀² */
  chiSquareObserved: number
  /** Critical chi-square value at (dof, 1-α) */
  chiSquareCritical: number
  /** Degrees of freedom */
  dof: number
  /** Significance level α (e.g., 0.05 for 95% confidence) */
  alpha: number
  /** p-value of the test */
  pValue: number
  /** Human-readable interpretation */
  interpretation: string
}

export interface WTestResult {
  /** Observation index (0-based) */
  observationIndex: number
  /** From station name */
  from: string
  /** To station name */
  to: string
  /** Component: 'E', 'N', or 'H' */
  component: 'E' | 'N' | 'H'
  /** Standardized residual (w-statistic) */
  wStatistic: number
  /** Critical value (z-score at 1-α/2) */
  criticalValue: number
  /** Whether this observation is flagged as a blunder */
  isBlunder: boolean
  /** The residual in observation units (meters) */
  residual: number
}

export interface ReliabilityResult {
  /** Observation index */
  observationIndex: number
  /** From station name */
  from: string
  /** To station name */
  to: string
  /** Component */
  component: 'E' | 'N' | 'H'
  /** Internal reliability — Minimal Detectable Bias (meters) */
  /** The smallest blunder that can be detected at the given α/β */
  mdb: number
  /** External reliability — effect of undetected blunder on coordinates (meters) */
  /** The maximum coordinate shift if an undetected blunder of size MDB exists */
  externalReliability: number
  /** Redundancy number (0 to 1) — 0 = no check, 1 = fully controlled */
  redundancyNumber: number
}

export interface StatisticalReport {
  /** Global chi-square test */
  globalTest: ChiSquareTestResult
  /** Per-observation w-test results (data snooping) */
  wTestResults: WTestResult[]
  /** Whether any blunders were detected */
  hasBlunders: boolean
  /** Number of blunders detected */
  blunderCount: number
  /** Reliability analysis per observation */
  reliability: ReliabilityResult[]
  /** Overall verdict for the adjustment */
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  /** Summary suitable for display in the UI */
  summary: string
  /** Detailed warnings */
  warnings: string[]
}

// ─── Chi-Square Distribution (inverse CDF approximation) ────────────────────

/**
 * Critical chi-square value for given DOF and significance level.
 * Uses the Wilson-Hilferty approximation (accurate to ~0.1% for dof > 5).
 *
 * @param dof — Degrees of freedom
 * @param alpha — Significance level (e.g., 0.05 for 95% confidence)
 * @returns Critical chi-square value χ²_(dof, 1-α)
 */
export function chiSquareCritical(dof: number, alpha: number): number {
  if (dof <= 0) return 0 // no degrees of freedom = no test
  const p = 1 - alpha
  // Wilson-Hilferty approximation (accurate to ~1% for dof >= 2; ~3% for dof=1)
  const z = inverseNormalCDF(p)
  const h = 2 / (9 * dof)
  const crit = dof * Math.pow(1 - h + z * Math.sqrt(h), 3)
  return Math.max(0, crit)
}

/**
 * p-value for a chi-square statistic (upper tail).
 * Uses the Wilson-Hilferty approximation.
 */
export function chiSquarePValue(chiSquare: number, dof: number): number {
  if (dof <= 0) return 1
  const h = 2 / (9 * dof)
  const x = Math.pow(chiSquare / dof, 1 / 3)
  const z = (x - (1 - h)) / Math.sqrt(h)
  // P(Z > z) = 1 - Φ(z)
  return 1 - normalCDF(z)
}

// ─── Normal Distribution ────────────────────────────────────────────────────

/**
 * Standard normal CDF Φ(z) using the Abramowitz-Stegun approximation.
 * Accurate to 7.5×10⁻⁸.
 */
export function normalCDF(z: number): number {
  const absZ = Math.abs(z)
  const t = 1 / (1 + 0.2316419 * absZ)
  const d = 0.3989423 * Math.exp(-absZ * absZ / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return z >= 0 ? 1 - p : p
}

/**
 * Inverse standard normal CDF (quantile function) using Acklam's algorithm.
 * Accurate to 1.15×10⁻⁹.
 */
export function inverseNormalCDF(p: number): number {
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

// ─── Global Chi-Square Test ─────────────────────────────────────────────────

/**
 * Baarda's global test for the overall validity of the adjustment.
 *
 * H₀: The adjustment is correct (no model errors, no blunders)
 * H₁: The adjustment is incorrect
 *
 * Test statistic: χ²_obs = v^T P v = dof × σ₀²
 * Reject H₀ if χ²_obs > χ²_(dof, 1-α)
 *
 * @param sigmaZero — Reference standard deviation (unit weight)
 * @param dof — Degrees of freedom (redundancy)
 * @param alpha — Significance level (default 0.05 = 95% confidence)
 */
export function globalChiSquareTest(
  sigmaZero: number,
  dof: number,
  alpha: number = 0.05,
): ChiSquareTestResult {
  const chiSquareObserved = dof > 0 ? dof * sigmaZero * sigmaZero : 0
  const chiSqCrit = chiSquareCritical(dof, alpha)
  const pValue = dof > 0 ? chiSquarePValue(chiSquareObserved, dof) : 1
  // When dof=0, there's no test (no redundancy). Mark as passed=true so the
  // verdict logic can check dof separately, but interpretation says INCONCLUSIVE.
  const passed = dof > 0 ? chiSquareObserved <= chiSqCrit : true

  let interpretation: string
  if (dof === 0) {
    interpretation = 'INCONCLUSIVE — zero degrees of freedom (no redundancy). Cannot perform statistical test.'
  } else if (passed) {
    interpretation = `PASS — Global test passed at ${(1 - alpha) * 100}% confidence. χ²_obs=${chiSquareObserved.toFixed(3)} ≤ χ²_crit=${chiSqCrit.toFixed(3)}. The adjustment is statistically valid.`
  } else {
    interpretation = `FAIL — Global test failed at ${(1 - alpha) * 100}% confidence. χ²_obs=${chiSquareObserved.toFixed(3)} > χ²_crit=${chiSqCrit.toFixed(3)}. The adjustment may contain blunders or the stochastic model is incorrect.`
  }

  return {
    passed,
    chiSquareObserved,
    chiSquareCritical: chiSqCrit,
    dof,
    alpha,
    pValue,
    interpretation,
  }
}

// ─── Baarda's w-test (Data Snooping) ────────────────────────────────────────

/**
 * Baarda's w-test for individual observation blunders (data snooping).
 *
 * For each observation, compute the standardized residual:
 *   w_i = v_i / (σ₀ × √(q_vv_ii))
 *
 * where q_vv_ii is the diagonal element of the cofactor matrix of residuals
 * (Qvv = P⁻¹ - A × Qxx × A^T).
 *
 * Under H₀ (no blunder), w ~ N(0,1). Reject if |w| > z_(1-α/2).
 *
 * @param residuals — Residual vector v
 * @param QvvDiag — Diagonal of Qvv (cofactor matrix of residuals)
 * @param sigmaZero — Reference standard deviation
 * @param observationLabels — Labels (from, to, component) for each residual
 * @param alpha — Significance level (default 0.05)
 */
export function baardaWTest(
  residuals: number[],
  QvvDiag: number[],
  sigmaZero: number,
  observationLabels: Array<{ from: string; to: string; component: 'E' | 'N' | 'H' }>,
  alpha: number = 0.05,
): WTestResult[] {
  const criticalValue = inverseNormalCDF(1 - alpha / 2)

  return residuals.map((v, i) => {
    const qvv = QvvDiag[i] || 0
    const denom = sigmaZero * Math.sqrt(Math.max(qvv, 0))
    const w = denom > 0 ? v / denom : 0
    const isBlunder = Math.abs(w) > criticalValue

    return {
      observationIndex: Math.floor(i / 3),
      from: observationLabels[i].from,
      to: observationLabels[i].to,
      component: observationLabels[i].component,
      wStatistic: w,
      criticalValue,
      isBlunder,
      residual: v,
    }
  })
}

// ─── Reliability Analysis ───────────────────────────────────────────────────

/**
 * Compute internal and external reliability per observation.
 *
 * Internal reliability (Minimal Detectable Bias, MDB):
 *   ∇₀_i = (σ₀ × √(q_vv_ii) × δ₀)
 *
 * where δ₀ is the non-centrality parameter for the chosen α and β.
 * For α=5%, β=20% (80% power): δ₀ = 4.13 (Baarda's λ₀).
 *
 * External reliability (effect of undetected blunder on coordinates):
 *   ∇_x_i = ∇₀_i × (Qxx × A^T × P)_column_i
 *
 * The maximum coordinate shift is the max absolute value of ∇_x_i.
 *
 * @param QvvDiag — Diagonal of Qvv
 * @param sigmaZero — Reference standard deviation
 * @param observationLabels — Labels for each residual
 * @param alpha — Significance level (default 0.05)
 * @param power — Test power (default 0.80 = 80%)
 */
export function computeReliability(
  QvvDiag: number[],
  sigmaZero: number,
  observationLabels: Array<{ from: string; to: string; component: 'E' | 'N' | 'H' }>,
  alpha: number = 0.05,
  power: number = 0.80,
): ReliabilityResult[] {
  // Non-centrality parameter δ₀ for the given α and power
  // For α=5%, power=80%: δ₀ = 4.13 (Baarda's standard value)
  // Approximation: δ₀ = z_(1-α) + z_(power)
  const delta0 = inverseNormalCDF(1 - alpha) + inverseNormalCDF(power)

  return QvvDiag.map((qvv, i) => {
    const mdb = sigmaZero * Math.sqrt(Math.max(qvv, 0)) * delta0
    const redundancyNumber = Math.max(0, Math.min(1, qvv))

    // External reliability: simplified — the effect on coordinates is
    // approximately mdb × (1 - redundancyNumber) / sqrt(redundancyNumber)
    // A full computation requires Qxx × A^T × P, but this approximation
    // gives the right order of magnitude for UI display.
    const externalReliability = redundancyNumber > 0.001
      ? mdb * (1 - redundancyNumber) / Math.sqrt(redundancyNumber)
      : Infinity

    return {
      observationIndex: Math.floor(i / 3),
      from: observationLabels[i].from,
      to: observationLabels[i].to,
      component: observationLabels[i].component,
      mdb,
      externalReliability,
      redundancyNumber,
    }
  })
}

// ─── Full Statistical Report ────────────────────────────────────────────────

/**
 * Compute a full statistical report for a least-squares adjustment.
 *
 * This is the function a boundary commission would want to see before
 * accepting an adjustment. It combines:
 *   1. Global chi-square test (overall validity)
 *   2. Baarda's w-test (individual blunder detection)
 *   3. Reliability analysis (MDB + external reliability)
 *
 * @param sigmaZero — Reference standard deviation from the adjustment
 * @param dof — Degrees of freedom
 * @param residuals — Residual vector (length = m×3)
 * @param QvvDiag — Diagonal of Qvv cofactor matrix (same length as residuals)
 * @param observationLabels — Labels for each residual entry
 * @param alpha — Significance level (default 0.05)
 */
export function computeStatisticalReport(
  sigmaZero: number,
  dof: number,
  residuals: number[],
  QvvDiag: number[],
  observationLabels: Array<{ from: string; to: string; component: 'E' | 'N' | 'H' }>,
  alpha: number = 0.05,
): StatisticalReport {
  const globalTest = globalChiSquareTest(sigmaZero, dof, alpha)
  const wTestResults = baardaWTest(residuals, QvvDiag, sigmaZero, observationLabels, alpha)
  const reliability = computeReliability(QvvDiag, sigmaZero, observationLabels, alpha)

  const blunders = wTestResults.filter(w => w.isBlunder)
  const hasBlunders = blunders.length > 0
  const blunderCount = blunders.length

  const warnings: string[] = []

  if (dof === 0) {
    warnings.push('Zero degrees of freedom — no redundancy. Statistical tests are inconclusive.')
  }

  if (!globalTest.passed && dof > 0) {
    warnings.push(`Global test failed at ${(1 - alpha) * 100}% confidence. The adjustment may contain blunders or the a priori standard deviations are incorrect.`)
  }

  if (hasBlunders) {
    const blunderList = blunders.map(b => `${b.from}→${b.to} (${b.component}): w=${b.wStatistic.toFixed(2)}`).join(', ')
    warnings.push(`${blunderCount} blunder(s) detected by w-test: ${blunderList}`)
  }

  // Check for low reliability (observations that can't be checked)
  const lowReliability = reliability.filter(r => r.redundancyNumber < 0.1)
  if (lowReliability.length > 0) {
    warnings.push(`${lowReliability.length} observation(s) have redundancy < 0.1 — these cannot be reliably checked for blunders.`)
  }

  // Overall verdict
  let verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  if (dof === 0) {
    verdict = 'INCONCLUSIVE'
  } else if (globalTest.passed && !hasBlunders) {
    verdict = 'PASS'
  } else {
    verdict = 'FAIL'
  }

  // Summary for UI display
  let summary: string
  if (verdict === 'PASS') {
    summary = `Global test PASSED at ${(1 - alpha) * 100}% confidence. No blunders detected. σ₀=${sigmaZero.toFixed(3)}, dof=${dof}.`
  } else if (verdict === 'FAIL') {
    summary = `Global test FAILED. ${blunderCount} blunder(s) detected. σ₀=${sigmaZero.toFixed(3)}, dof=${dof}.`
  } else {
    summary = `INCONCLUSIVE — zero degrees of freedom. No statistical testing possible.`
  }

  return {
    globalTest,
    wTestResults,
    hasBlunders,
    blunderCount,
    reliability,
    verdict,
    summary,
    warnings,
  }
}

// ─── Qvv Diagonal Computation ───────────────────────────────────────────────

/**
 * Compute the diagonal of the Qvv matrix (cofactor matrix of residuals).
 *
 * Qvv = P⁻¹ - A × Qxx × A^T
 *
 * The diagonal elements are needed for the w-test and reliability analysis.
 * This function computes ONLY the diagonal (not the full matrix) for efficiency.
 *
 * @param A — Design matrix (m×n)
 * @param W — Weight vector (diagonal of P)
 * @param Qxx — Cofactor matrix of adjusted parameters (n×n)
 * @returns Diagonal of Qvv (length = m)
 */
export function computeQvvDiagonal(
  A: number[][],
  W: number[],
  Qxx: number[][],
): number[] {
  const m = A.length
  const n = A[0].length
  const QvvDiag: number[] = new Array(m)

  for (let i = 0; i < m; i++) {
    // P⁻¹ diagonal = 1/W[i]
    const Pinv = 1 / W[i]

    // (A × Qxx × A^T) diagonal = sum over j,k of A[i][j] × Qxx[j][k] × A[i][k]
    let aQxxAt = 0
    for (let j = 0; j < n; j++) {
      if (A[i][j] === 0) continue
      for (let k = 0; k < n; k++) {
        if (A[i][k] === 0) continue
        aQxxAt += A[i][j] * Qxx[j][k] * A[i][k]
      }
    }

    QvvDiag[i] = Pinv - aQxxAt
  }

  return QvvDiag
}
