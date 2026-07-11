/**
 * Residual Diagnostics — validate LSA assumptions
 *
 * PROBLEM
 * -------
 * The w-test (Baarda data snooping) assumes residuals are normally distributed
 * and uncorrelated. If either assumption is violated:
 *   - The w-test flags too many or too few blunders
 *   - The chi-square test gives false positives/negatives
 *   - The MDB (reliability) numbers are wrong
 *
 * Without diagnostic tests, you can't tell whether a "FAILED" global test
 * means real blunders or just non-normal residuals (e.g., from systematic
 * errors like an uncorrected refraction bias).
 *
 * This module implements:
 *   1. Kolmogorov-Smirnov test for normality (compares empirical CDF to
 *      theoretical normal CDF)
 *   2. Anderson-Darling test (more sensitive to tail deviations)
 *   3. Durbin-Watson test for autocorrelation (detects time-correlated
 *      residuals, common in GPS observation sequences)
 *   4. Skewness and kurtosis (3rd and 4th moments)
 *
 * REFERENCES
 * ----------
 * - Kolmogorov, A.N. (1933). "Sulla determinazione empirica di una legge di
 *   distribuzione." Giornale dell'Istituto Italiano degli Attuari, 4.
 * - Smirnov, N.V. (1948). "Table for estimating the goodness of fit of
 *   empirical distributions." Annals of Mathematical Statistics, 19.
 * - Anderson, T.W. & Darling, D.A. (1952). "Asymptotic theory of certain
 *   'goodness of fit' criteria based on stochastic processes." Annals of
 *   Mathematical Statistics, 23.
 * - Durbin, J. & Watson, G.S. (1950). "Testing for serial correlation in
 *   least squares regression, I." Biometrika, 37.
 * - Ghilani, C.D. (2017). Adjustment Computations, 6th ed. Wiley, §5.6.
 */

import { normalCDF } from '../survey/lsaStatisticalTesting'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NormalityTestResult {
  /** Test name */
  test: 'kolmogorov-smirnov' | 'anderson-darling' | 'shapiro-wilk-approx'
  /** Test statistic */
  statistic: number
  /** Critical value at the chosen significance level */
  criticalValue: number
  /** p-value (approximation) */
  pValue: number
  /** Whether residuals pass the normality test */
  passed: boolean
  /** Significance level */
  alpha: number
  /** Sample size */
  n: number
  /** Interpretation */
  interpretation: string
}

export interface DurbinWatsonResult {
  /** Durbin-Watson statistic (0 ≤ DW ≤ 4) */
  statistic: number
  /** Lower critical value (dL) at alpha */
  dLower: number
  /** Upper critical value (dU) at alpha */
  dUpper: number
  /** Conclusion: 'no_autocorrelation' | 'positive_autocorrelation' | 'negative_autocorrelation' | 'inconclusive' */
  conclusion: 'no_autocorrelation' | 'positive_autocorrelation' | 'negative_autocorrelation' | 'inconclusive'
  /** Interpretation */
  interpretation: string
}

export interface MomentStats {
  mean: number
  standardDeviation: number
  skewness: number
  kurtosis: number      // excess kurtosis (normal = 0)
  min: number
  max: number
  n: number
}

export interface ResidualDiagnostics {
  /** Sample size */
  n: number
  /** Moment statistics */
  moments: MomentStats
  /** Kolmogorov-Smirnov normality test */
  kolmogorovSmirnov: NormalityTestResult
  /** Anderson-Darling normality test */
  andersonDarling: NormalityTestResult
  /** Durbin-Watson autocorrelation test (only if observationOrder is provided) */
  durbinWatson?: DurbinWatsonResult
  /** Overall assessment */
  passed: boolean
  /** Summary */
  summary: string
  /** Warnings */
  warnings: string[]
}

// ─── Moment Statistics ──────────────────────────────────────────────────────

/**
 * Compute mean, standard deviation, skewness, and excess kurtosis.
 *
 * Skewness: γ₁ = (1/n) Σ ((xᵢ - x̄)/s)³
 *   Normal: γ₁ = 0
 *   Positive skew = right tail heavier (e.g., from one-sided blunders)
 *
 * Excess kurtosis: γ₂ = (1/n) Σ ((xᵢ - x̄)/s)⁴ - 3
 *   Normal: γ₂ = 0
 *   Positive = heavy tails (leptokurtic, common with blunders)
 *   Negative = light tails (platykurtic, from over-weighted observations)
 */
export function computeMoments(residuals: number[]): MomentStats {
  const n = residuals.length
  if (n === 0) {
    return { mean: 0, standardDeviation: 0, skewness: 0, kurtosis: 0, min: 0, max: 0, n: 0 }
  }

  const mean = residuals.reduce((s, r) => s + r, 0) / n
  const deviations = residuals.map(r => r - mean)
  const variance = deviations.reduce((s, d) => s + d * d, 0) / n
  const sd = Math.sqrt(variance)

  if (sd === 0) {
    return { mean, standardDeviation: 0, skewness: 0, kurtosis: 0, min: mean, max: mean, n }
  }

  let sumCubed = 0, sumFourth = 0
  for (const d of deviations) {
    const normalized = d / sd
    sumCubed += normalized ** 3
    sumFourth += normalized ** 4
  }

  const skewness = sumCubed / n
  const kurtosis = sumFourth / n - 3  // excess kurtosis

  const min = Math.min(...residuals)
  const max = Math.max(...residuals)

  return { mean, standardDeviation: sd, skewness, kurtosis, min, max, n }
}

// ─── Kolmogorov-Smirnov Test ────────────────────────────────────────────────

/**
 * Kolmogorov-Smirnov test for normality.
 *
 * Compares the empirical CDF of the (standardized) residuals to the
 * theoretical standard normal CDF. The test statistic is the maximum
 * absolute difference:
 *   D = max |F_empirical(x) - F_normal(x)|
 *
 * Critical values (α = 0.05):
 *   D_crit ≈ 1.36 / √n   (large-sample approximation)
 *
 * @param residuals - Residual vector
 * @param alpha - Significance level (default 0.05)
 */
export function kolmogorovSmirnovTest(
  residuals: number[],
  alpha: number = 0.05,
): NormalityTestResult {
  const n = residuals.length
  if (n < 5) {
    return {
      test: 'kolmogorov-smirnov',
      statistic: 0,
      criticalValue: 1,
      pValue: 1,
      passed: true,
      alpha,
      n,
      interpretation: 'Sample too small (n<5) — K-S test inconclusive.',
    }
  }

  // Standardize residuals (subtract mean, divide by SD)
  const mean = residuals.reduce((s, r) => s + r, 0) / n
  const variance = residuals.reduce((s, r) => s + (r - mean) ** 2, 0) / n
  const sd = Math.sqrt(variance)
  if (sd === 0) {
    return {
      test: 'kolmogorov-smirnov',
      statistic: 0,
      criticalValue: 1.36 / Math.sqrt(n),
      pValue: 1,
      passed: true,
      alpha,
      n,
      interpretation: 'All residuals identical (zero variance) — normality trivially satisfied.',
    }
  }

  const standardized = residuals.map(r => (r - mean) / sd)
  standardized.sort((a, b) => a - b)

  // Compute K-S statistic: D = max |F_emp(x) - F_norm(x)|
  let dMax = 0
  for (let i = 0; i < n; i++) {
    // Empirical CDF at standardized[i]: (i+1)/n
    const fEmpiricalHigh = (i + 1) / n
    const fEmpiricalLow = i / n
    const fNormal = normalCDF(standardized[i])

    const diffHigh = Math.abs(fEmpiricalHigh - fNormal)
    const diffLow = Math.abs(fNormal - fEmpiricalLow)
    dMax = Math.max(dMax, diffHigh, diffLow)
  }

  // Critical value: D_crit = c(α) / √n
  // c(0.10) = 1.224, c(0.05) = 1.358, c(0.01) = 1.628
  const cAlpha = alpha === 0.10 ? 1.224 : alpha === 0.01 ? 1.628 : 1.358
  const criticalValue = cAlpha / Math.sqrt(n)

  // p-value approximation (Marsaglia, 2003 — simplified):
  // p = 2 · Σ (-1)^(k-1) · exp(-2·k²·λ²),  λ = (√n + 0.12 + 0.11/√n) · D
  const lambda = (Math.sqrt(n) + 0.12 + 0.11 / Math.sqrt(n)) * dMax
  let pValue = 0
  for (let k = 1; k <= 100; k++) {
    const term = 2 * Math.pow(-1, k - 1) * Math.exp(-2 * k * k * lambda * lambda)
    pValue += term
    if (Math.abs(term) < 1e-10) break
  }
  pValue = Math.max(0, Math.min(1, pValue))

  const passed = dMax <= criticalValue

  let interpretation: string
  if (passed) {
    interpretation = `PASS — Residuals are normally distributed at ${(1 - alpha) * 100}% confidence (D=${dMax.toFixed(4)} ≤ D_crit=${criticalValue.toFixed(4)}, p=${pValue.toFixed(3)}). The w-test and chi-square test assumptions are valid.`
  } else {
    interpretation = `FAIL — Residuals deviate from normal at ${(1 - alpha) * 100}% confidence (D=${dMax.toFixed(4)} > D_crit=${criticalValue.toFixed(4)}, p=${pValue.toFixed(3)}). The w-test may produce false positives/negatives. Investigate: systematic errors, unmodeled refraction, or heavy-tailed observations.`
  }

  return {
    test: 'kolmogorov-smirnov',
    statistic: dMax,
    criticalValue,
    pValue,
    passed,
    alpha,
    n,
    interpretation,
  }
}

// ─── Anderson-Darling Test ──────────────────────────────────────────────────

/**
 * Anderson-Darling test for normality.
 *
 * More sensitive than K-S to deviations in the tails (where blunders show up).
 *
 *   A² = -n - (1/n) Σ [(2i-1)·ln(F(xᵢ)) + (2(n-i)+1)·ln(1-F(xᵢ))]
 *
 * Critical values (α = 0.05): A²_crit = 0.787 (adjusted for estimated parameters: 0.752)
 *
 * @param residuals - Residual vector
 * @param alpha - Significance level (default 0.05)
 */
export function andersonDarlingTest(
  residuals: number[],
  alpha: number = 0.05,
): NormalityTestResult {
  const n = residuals.length
  if (n < 8) {
    return {
      test: 'anderson-darling',
      statistic: 0,
      criticalValue: 0.787,
      pValue: 1,
      passed: true,
      alpha,
      n,
      interpretation: 'Sample too small (n<8) — A-D test inconclusive.',
    }
  }

  const mean = residuals.reduce((s, r) => s + r, 0) / n
  const variance = residuals.reduce((s, r) => s + (r - mean) ** 2, 0) / n
  const sd = Math.sqrt(variance)
  if (sd === 0) {
    return {
      test: 'anderson-darling',
      statistic: 0,
      criticalValue: 0.787,
      pValue: 1,
      passed: true,
      alpha,
      n,
      interpretation: 'All residuals identical — normality trivially satisfied.',
    }
  }

  const standardized = residuals.map(r => (r - mean) / sd)
  standardized.sort((a, b) => a - b)

  let aSquared = 0
  for (let i = 0; i < n; i++) {
    const f = normalCDF(standardized[i])
    const fClamped = Math.max(1e-15, Math.min(1 - 1e-15, f))
    const oneMinusF = 1 - fClamped
    aSquared += (2 * (i + 1) - 1) * Math.log(fClamped) + (2 * (n - i - 1) + 1) * Math.log(oneMinusF)
  }
  aSquared = -n - aSquared / n

  // Adjust for estimated parameters (mean & SD estimated from data):
  // A²* = A² · (1 + 0.75/n + 2.25/n²)
  const aSquaredAdj = aSquared * (1 + 0.75 / n + 2.25 / (n * n))

  // Critical values for adjusted A² (Stephens, 1974):
  // α=0.10: 0.631, α=0.05: 0.752, α=0.025: 0.873, α=0.01: 1.035
  const criticalValue = alpha === 0.10 ? 0.631 : alpha === 0.025 ? 0.873 : alpha === 0.01 ? 1.035 : 0.752

  // p-value approximation (D'Agostino & Stephens, 1986):
  let pValue: number
  if (aSquaredAdj < 0.200) {
    pValue = 1 - Math.exp(-13.436 + 101.14 * aSquaredAdj - 223.73 * aSquaredAdj ** 2)
  } else if (aSquaredAdj < 0.340) {
    pValue = 1 - Math.exp(-8.318 + 42.796 * aSquaredAdj - 59.938 * aSquaredAdj ** 2)
  } else if (aSquaredAdj < 0.600) {
    pValue = Math.exp(0.9177 - 4.279 * aSquaredAdj - 1.38 * aSquaredAdj ** 2)
  } else {
    pValue = Math.exp(1.2937 - 5.709 * aSquaredAdj + 0.0186 * aSquaredAdj ** 2)
  }
  pValue = Math.max(0, Math.min(1, pValue))

  const passed = aSquaredAdj <= criticalValue

  let interpretation: string
  if (passed) {
    interpretation = `PASS — Anderson-Darling test passes at ${(1 - alpha) * 100}% confidence (A²=${aSquaredAdj.toFixed(4)} ≤ A²_crit=${criticalValue}, p=${pValue.toFixed(3)}). Residuals are normally distributed including in the tails.`
  } else {
    interpretation = `FAIL — Anderson-Darling test fails at ${(1 - alpha) * 100}% confidence (A²=${aSquaredAdj.toFixed(4)} > A²_crit=${criticalValue}, p=${pValue.toFixed(3)}). Residuals deviate from normal — likely heavy tails from blunders or systematic errors.`
  }

  return {
    test: 'anderson-darling',
    statistic: aSquaredAdj,
    criticalValue,
    pValue,
    passed,
    alpha,
    n,
    interpretation,
  }
}

// ─── Durbin-Watson Test ─────────────────────────────────────────────────────

/**
 * Durbin-Watson test for autocorrelation in residuals.
 *
 *   DW = Σ (eᵢ - eᵢ₋₁)² / Σ eᵢ²
 *
 * DW ≈ 2 → no autocorrelation
 * DW < 2 → positive autocorrelation (residuals correlated with neighbors)
 * DW > 2 → negative autocorrelation (alternating residuals)
 *
 * Critical values dL and dU depend on n and α. For n > 50, use the
 * approximation: dL ≈ 2 - 2·z_(1-α)·√(n/(n²-1))
 *
 * @param residuals - Residual vector in OBSERVATION ORDER (not sorted)
 * @param alpha - Significance level (default 0.05)
 */
export function durbinWatsonTest(
  residuals: number[],
  alpha: number = 0.05,
): DurbinWatsonResult {
  const n = residuals.length
  if (n < 15) {
    return {
      statistic: 2,
      dLower: 0,
      dUpper: 4,
      conclusion: 'inconclusive',
      interpretation: 'Sample too small (n<15) — Durbin-Watson test inconclusive.',
    }
  }

  // DW = Σ (eᵢ - eᵢ₋₁)² / Σ eᵢ²
  let numerator = 0
  let denominator = 0
  for (let i = 0; i < n; i++) {
    denominator += residuals[i] ** 2
    if (i > 0) {
      numerator += (residuals[i] - residuals[i - 1]) ** 2
    }
  }

  if (denominator === 0) {
    return {
      statistic: 2,
      dLower: 0,
      dUpper: 4,
      conclusion: 'inconclusive',
      interpretation: 'All residuals are zero — cannot compute DW.',
    }
  }

  const dw = numerator / denominator

  // Approximate critical values for large n (Savin & White, 1977):
  // For α=0.05, k=1 (one predictor):
  //   dL ≈ 2 - 2·1.645·√(1 + 1/(n-1))   (approximation)
  // Use the simplified formula: dL = 1.20, dU = 1.41 for n=25;
  // dL = 1.50, dU = 1.59 for n=50; dL = 1.65, dU = 1.69 for n=100
  // Linear interpolation for other n.
  const dLower = interpolateDWCritical(n, 'dL', alpha)
  const dUpper = interpolateDWCritical(n, 'dU', alpha)

  let conclusion: DurbinWatsonResult['conclusion']
  let interpretation: string

  if (dw < dLower) {
    conclusion = 'positive_autocorrelation'
    interpretation = `POSITIVE AUTOCORRELATION detected (DW=${dw.toFixed(3)} < dL=${dLower.toFixed(3)}). Residuals are correlated with their neighbors — likely from time-series observations or unmodeled systematic effects. The LSA assumption of independence is violated; standard deviations are underestimated.`
  } else if (dw > 4 - dLower) {
    conclusion = 'negative_autocorrelation'
    interpretation = `NEGATIVE AUTOCORRELATION detected (DW=${dw.toFixed(3)} > 4-dL=${(4 - dLower).toFixed(3)}). Residuals alternate in sign — possibly from over-correction or oscillating systematic errors.`
  } else if (dw >= dUpper && dw <= 4 - dUpper) {
    conclusion = 'no_autocorrelation'
    interpretation = `PASS — No autocorrelation detected (dU=${dUpper.toFixed(3)} ≤ DW=${dw.toFixed(3)} ≤ 4-dU=${(4 - dUpper).toFixed(3)}). Residuals are independent. LSA assumptions valid.`
  } else {
    conclusion = 'inconclusive'
    interpretation = `INCONCLUSIVE — DW statistic (${dw.toFixed(3)}) is in the inconclusive zone (between dL=${dLower.toFixed(3)} and dU=${dUpper.toFixed(3)} or their mirror). Increase sample size or investigate.`
  }

  return {
    statistic: dw,
    dLower,
    dUpper,
    conclusion,
    interpretation,
  }
}

// Critical value table (Savin & White, 1977) for k=1 (single regression):
// α=0.05:  n=15: dL=1.08, dU=1.36; n=20: dL=1.20, dU=1.41; n=25: dL=1.29, dU=1.45;
//          n=30: dL=1.35, dU=1.49; n=40: dL=1.44, dU=1.54; n=50: dL=1.50, dU=1.59;
//          n=75: dL=1.58, dU=1.64; n=100: dL=1.65, dU=1.69; n=200: dL=1.76, dU=1.78
function interpolateDWCritical(n: number, which: 'dL' | 'dU', alpha: number): number {
  // Use α=0.05 table (most common); for other alphas, scale proportionally
  const table = [
    { n: 15,  dL: 1.08, dU: 1.36 },
    { n: 20,  dL: 1.20, dU: 1.41 },
    { n: 25,  dL: 1.29, dU: 1.45 },
    { n: 30,  dL: 1.35, dU: 1.49 },
    { n: 40,  dL: 1.44, dU: 1.54 },
    { n: 50,  dL: 1.50, dU: 1.59 },
    { n: 75,  dL: 1.58, dU: 1.64 },
    { n: 100, dL: 1.65, dU: 1.69 },
    { n: 200, dL: 1.76, dU: 1.78 },
  ]

  // Linear interpolation in log(n) space
  let val: number
  if (n <= table[0].n) {
    val = which === 'dL' ? table[0].dL : table[0].dU
  } else if (n >= table[table.length - 1].n) {
    val = which === 'dL' ? table[table.length - 1].dL : table[table.length - 1].dU
  } else {
    for (let i = 0; i < table.length - 1; i++) {
      if (n >= table[i].n && n <= table[i + 1].n) {
        const t = (n - table[i].n) / (table[i + 1].n - table[i].n)
        const a = which === 'dL' ? table[i].dL : table[i].dU
        const b = which === 'dL' ? table[i + 1].dL : table[i + 1].dU
        val = a + t * (b - a)
        break
      }
    }
  }

  // Adjust for alpha (rough): α=0.01 widens the inconclusive zone
  const alphaAdjust = alpha === 0.01 ? 0.92 : alpha === 0.10 ? 1.05 : 1.0

  // For α=0.01, dL is lower and dU is also lower; for α=0.10, both higher
  // This is a rough scaling — for production, use exact tables
  return val! * alphaAdjust
}

// ─── Full Diagnostics ───────────────────────────────────────────────────────

/**
 * Compute full residual diagnostics for an LSA adjustment.
 *
 * @param residuals - Residual vector (in observation order for DW test)
 * @param options - Whether to include Durbin-Watson test
 */
export function computeResidualDiagnostics(
  residuals: number[],
  options: {
    includeDurbinWatson?: boolean
    alpha?: number
  } = {},
): ResidualDiagnostics {
  const alpha = options.alpha ?? 0.05
  const n = residuals.length

  const moments = computeMoments(residuals)
  const ks = kolmogorovSmirnovTest(residuals, alpha)
  const ad = andersonDarlingTest(residuals, alpha)
  const dw = options.includeDurbinWatson ? durbinWatsonTest(residuals, alpha) : undefined

  const warnings: string[] = []

  // Skewness check (z-test using SE = √(6/n))
  if (n >= 30) {
    const skewSE = Math.sqrt(6 / n)
    const skewZ = moments.skewness / skewSE
    if (Math.abs(skewZ) > 1.96) {
      warnings.push(`Skewness is significant (γ₁=${moments.skewness.toFixed(3)}, z=${skewZ.toFixed(2)}). Distribution is asymmetric — possible one-sided systematic error.`)
    }
  }

  // Kurtosis check (z-test using SE = √(24/n))
  if (n >= 30) {
    const kurtSE = Math.sqrt(24 / n)
    const kurtZ = moments.kurtosis / kurtSE
    if (Math.abs(kurtZ) > 1.96) {
      warnings.push(`Excess kurtosis is significant (γ₂=${moments.kurtosis.toFixed(3)}, z=${kurtZ.toFixed(2)}). ${moments.kurtosis > 0 ? 'Heavy tails — possible blunders.' : 'Light tails — observations may be over-weighted.'}`)
    }
  }

  if (!ks.passed) {
    warnings.push(`Kolmogorov-Smirnov test failed — residuals are not normally distributed.`)
  }
  if (!ad.passed) {
    warnings.push(`Anderson-Darling test failed — residuals deviate from normal in the tails.`)
  }
  if (dw && (dw.conclusion === 'positive_autocorrelation' || dw.conclusion === 'negative_autocorrelation')) {
    warnings.push(`Durbin-Watson test indicates ${dw.conclusion.replace('_', ' ')} — LSA independence assumption violated.`)
  }

  const passed = ks.passed && ad.passed && (!dw || dw.conclusion === 'no_autocorrelation')

  let summary: string
  if (passed) {
    summary = `Residual diagnostics PASS at ${(1 - alpha) * 100}% confidence. K-S: ${ks.statistic.toFixed(4)}/${ks.criticalValue.toFixed(4)}, A-D: ${ad.statistic.toFixed(4)}/${ad.criticalValue.toFixed(4)}${dw ? `, DW: ${dw.statistic.toFixed(3)}` : ''}. Skewness=${moments.skewness.toFixed(3)}, Kurtosis=${moments.kurtosis.toFixed(3)}. LSA assumptions are valid; the w-test and chi-square test results are trustworthy.`
  } else {
    summary = `Residual diagnostics FAIL at ${(1 - alpha) * 100}% confidence. ${warnings.length} warning(s). The LSA assumption of independent, normally-distributed residuals is violated — statistical test results (w-test, chi-square) may be unreliable.`
  }

  return {
    n,
    moments,
    kolmogorovSmirnov: ks,
    andersonDarling: ad,
    durbinWatson: dw,
    passed,
    summary,
    warnings,
  }
}
