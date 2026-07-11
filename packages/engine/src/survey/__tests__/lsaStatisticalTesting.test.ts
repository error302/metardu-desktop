/**
 * Tests for LSA Statistical Testing module
 *
 * Verifies the chi-square distribution approximation, w-test, and reliability
 * analysis against known reference values from Ghilani (2017) and Baarda (1968).
 */

import {
  chiSquareCritical,
  chiSquarePValue,
  normalCDF,
  inverseNormalCDF,
  globalChiSquareTest,
  baardaWTest,
  computeReliability,
  computeStatisticalReport,
  computeQvvDiagonal,
} from '../lsaStatisticalTesting'

// ─── Normal Distribution ────────────────────────────────────────────────────

describe('normalCDF', () => {
  it('returns 0.5 at z=0', () => {
    expect(normalCDF(0)).toBeCloseTo(0.5, 6)
  })

  it('returns ~0.9772 at z=2 (the standard 95% one-tailed value)', () => {
    expect(normalCDF(2)).toBeCloseTo(0.9772, 3)
  })

  it('returns ~0.0228 at z=-2', () => {
    expect(normalCDF(-2)).toBeCloseTo(0.0228, 3)
  })
})

describe('inverseNormalCDF', () => {
  it('returns 0 at p=0.5', () => {
    expect(inverseNormalCDF(0.5)).toBeCloseTo(0, 6)
  })

  it('returns 1.96 at p=0.975 (the standard 95% two-tailed critical value)', () => {
    expect(inverseNormalCDF(0.975)).toBeCloseTo(1.96, 2)
  })

  it('is the inverse of normalCDF', () => {
    for (const p of [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
      expect(normalCDF(inverseNormalCDF(p))).toBeCloseTo(p, 4)
    }
  })
})

// ─── Chi-Square Distribution ────────────────────────────────────────────────

describe('chiSquareCritical', () => {
  it('returns ~3.84 for dof=1, alpha=0.05 (the standard 95% value)', () => {
    // χ²(1, 0.95) = 3.841. Wilson-Hilferty is ~3% off at dof=1.
    expect(chiSquareCritical(1, 0.05)).toBeCloseTo(3.84, 0)
  })

  it('returns ~11.07 for dof=5, alpha=0.05', () => {
    // χ²(5, 0.95) = 11.070
    expect(chiSquareCritical(5, 0.05)).toBeCloseTo(11.07, 1)
  })

  it('returns ~16.92 for dof=9, alpha=0.05', () => {
    // χ²(9, 0.95) = 16.919
    expect(chiSquareCritical(9, 0.05)).toBeCloseTo(16.92, 1)
  })

  it('increases with dof', () => {
    expect(chiSquareCritical(10, 0.05)).toBeGreaterThan(chiSquareCritical(5, 0.05))
  })
})

describe('chiSquarePValue', () => {
  it('returns 1 for chiSquare=0', () => {
    expect(chiSquarePValue(0, 5)).toBeCloseTo(1, 3)
  })

  it('returns a small p-value for chiSquare=11.07, dof=5', () => {
    // P(χ² > 11.07 | dof=5) ≈ 0.05 — Wilson-Hilferty approx may differ slightly
    const p = chiSquarePValue(11.07, 5)
    expect(p).toBeGreaterThan(0.01)
    expect(p).toBeLessThan(0.10)
  })
})

// ─── Global Chi-Square Test ─────────────────────────────────────────────────

describe('globalChiSquareTest', () => {
  it('PASSES when sigmaZero is close to 1 (good adjustment)', () => {
    // For a good adjustment: σ₀ ≈ 1, dof=10
    // χ²_obs = 10 × 1² = 10, χ²_crit(10, 0.05) ≈ 18.31
    const result = globalChiSquareTest(1.0, 10, 0.05)
    expect(result.passed).toBe(true)
    expect(result.chiSquareObserved).toBe(10)
  })

  it('FAILS when sigmaZero is very high (bad adjustment)', () => {
    // For a bad adjustment: σ₀ = 5, dof=10
    // χ²_obs = 10 × 25 = 250 >> 18.31
    const result = globalChiSquareTest(5.0, 10, 0.05)
    expect(result.passed).toBe(false)
    expect(result.chiSquareObserved).toBe(250)
  })

  it('is INCONCLUSIVE when dof=0', () => {
    const result = globalChiSquareTest(1.0, 0, 0.05)
    expect(result.passed).toBe(true) // 0 <= critical, but interpretation says inconclusive
    expect(result.interpretation).toContain('INCONCLUSIVE')
  })
})

// ─── Baarda w-test ──────────────────────────────────────────────────────────

describe('baardaWTest', () => {
  it('flags residuals with |w| > 1.96 as blunders (at α=0.05)', () => {
    const residuals = [0.001, 0.05, 0.001] // middle one is a blunder
    const QvvDiag = [0.0001, 0.0001, 0.0001]
    const sigmaZero = 1.0
    const labels = [
      { from: 'A', to: 'B', component: 'E' as const },
      { from: 'A', to: 'B', component: 'N' as const },
      { from: 'A', to: 'B', component: 'H' as const },
    ]

    const results = baardaWTest(residuals, QvvDiag, sigmaZero, labels, 0.05)
    expect(results).toHaveLength(3)
    expect(results[0].isBlunder).toBe(false) // w ≈ 0.1
    expect(results[1].isBlunder).toBe(true)  // w = 0.05 / (1 × 0.01) = 5.0 > 1.96
    expect(results[2].isBlunder).toBe(false)
  })

  it('returns critical value ≈ 1.96 for α=0.05', () => {
    const results = baardaWTest([0], [0.0001], 1.0, [{ from: 'A', to: 'B', component: 'E' }], 0.05)
    expect(results[0].criticalValue).toBeCloseTo(1.96, 1)
  })

  it('handles zero Qvv (uncontrollable observation) gracefully', () => {
    const results = baardaWTest([0.05], [0], 1.0, [{ from: 'A', to: 'B', component: 'E' }], 0.05)
    expect(results[0].wStatistic).toBe(0) // can't compute, default to 0
    expect(results[0].isBlunder).toBe(false)
  })
})

// ─── Reliability Analysis ───────────────────────────────────────────────────

describe('computeReliability', () => {
  it('computes MDB (Minimal Detectable Bias) for each observation', () => {
    const QvvDiag = [0.0001, 0.0001]
    const sigmaZero = 1.0
    const labels = [
      { from: 'A', to: 'B', component: 'E' as const },
      { from: 'A', to: 'B', component: 'N' as const },
    ]

    const results = computeReliability(QvvDiag, sigmaZero, labels, 0.05, 0.80)
    expect(results).toHaveLength(2)
    // MDB = σ₀ × √(qvv) × δ₀
    // δ₀ = z_(1-α) + z_(power) for the 1D test
    // For α=0.05, power=0.80: δ₀ = z_(0.95) + z_(0.80) = 1.645 + 0.842 = 2.487
    const expectedDelta0 = 2.487
    const expectedMdb = 1.0 * Math.sqrt(0.0001) * expectedDelta0
    expect(results[0].mdb).toBeCloseTo(expectedMdb, 2)
  })

  it('redundancy number = qvv (clamped to [0,1])', () => {
    const results = computeReliability([0.5, 0.0, 1.5], 1.0, [
      { from: 'A', to: 'B', component: 'E' as const },
      { from: 'A', to: 'B', component: 'N' as const },
      { from: 'A', to: 'B', component: 'H' as const },
    ])
    expect(results[0].redundancyNumber).toBe(0.5)
    expect(results[1].redundancyNumber).toBe(0)
    expect(results[2].redundancyNumber).toBe(1) // clamped from 1.5
  })

  it('flags low-redundancy observations (< 0.1) via Infinity external reliability', () => {
    const results = computeReliability([0.0001], 1.0, [
      { from: 'A', to: 'B', component: 'E' as const },
    ])
    // Very low redundancy → very high external reliability
    expect(results[0].externalReliability).toBeGreaterThan(results[0].mdb)
  })
})

// ─── Full Statistical Report ────────────────────────────────────────────────

describe('computeStatisticalReport', () => {
  it('returns PASS for a well-adjusted network', () => {
    // Good adjustment: σ₀ ≈ 1, no large residuals
    const report = computeStatisticalReport(
      1.0,  // sigmaZero
      10,   // dof
      [0.001, 0.001, 0.001, 0.001], // small residuals
      [0.5, 0.5, 0.5, 0.5], // good Qvv
      [
        { from: 'A', to: 'B', component: 'E' as const },
        { from: 'A', to: 'B', component: 'N' as const },
        { from: 'B', to: 'C', component: 'E' as const },
        { from: 'B', to: 'C', component: 'N' as const },
      ],
    )

    expect(report.verdict).toBe('PASS')
    expect(report.hasBlunders).toBe(false)
    expect(report.globalTest.passed).toBe(true)
    expect(report.summary).toContain('PASSED')
  })

  it('returns FAIL for a network with a blunder', () => {
    // Bad adjustment: one huge residual that triggers the w-test
    // w = v / (σ₀ × √(qvv)). For v=0.5, σ₀=5.0, qvv=0.5: w = 0.5/(5×0.707) = 0.14 — NOT a blunder
    // Need w > 1.96. With σ₀=1.0, qvv=0.01, v=0.5: w = 0.5/(1×0.1) = 5.0 — blunder!
    const report = computeStatisticalReport(
      5.0,  // high sigmaZero → global test fails
      10,
      [0.001, 0.5, 0.001, 0.001], // large residual
      [0.0001, 0.0001, 0.0001, 0.0001], // small qvv → high w
      [
        { from: 'A', to: 'B', component: 'E' as const },
        { from: 'A', to: 'B', component: 'N' as const },
        { from: 'B', to: 'C', component: 'E' as const },
        { from: 'B', to: 'C', component: 'N' as const },
      ],
    )

    expect(report.verdict).toBe('FAIL')
    expect(report.hasBlunders).toBe(true)
    expect(report.blunderCount).toBeGreaterThan(0)
    expect(report.summary).toContain('FAILED')
  })

  it('returns INCONCLUSIVE when dof=0', () => {
    const report = computeStatisticalReport(
      1.0, 0, [], [], [],
    )
    expect(report.verdict).toBe('INCONCLUSIVE')
    expect(report.warnings.length).toBeGreaterThan(0)
  })
})

// ─── Qvv Diagonal ───────────────────────────────────────────────────────────

describe('computeQvvDiagonal', () => {
  it('computes the diagonal of Qvv = P⁻¹ - A×Qxx×A^T', () => {
    // Simple 2-observation, 1-parameter example
    // A = [[1], [1]], W = [1, 1], Qxx = [[0.5]]
    // P⁻¹ = [1, 1]
    // A×Qxx×A^T diagonal = [1×0.5×1, 1×0.5×1] = [0.5, 0.5]
    // Qvv diag = [1-0.5, 1-0.5] = [0.5, 0.5]
    const A = [[1], [1]]
    const W = [1, 1]
    const Qxx = [[0.5]]
    const QvvDiag = computeQvvDiagonal(A, W, Qxx)
    expect(QvvDiag).toHaveLength(2)
    expect(QvvDiag[0]).toBeCloseTo(0.5, 6)
    expect(QvvDiag[1]).toBeCloseTo(0.5, 6)
  })

  it('redundancy numbers sum to dof', () => {
    // The sum of diagonal elements of Qvv × P = trace(Qvv × P) = dof
    // This is a fundamental property of least-squares adjustments
    const A = [[1, 0], [0, 1], [1, 1]]
    const W = [1, 1, 1]
    // Qxx = (A^T P A)^-1 = [[1,0],[0,1]]^-1 ... let's compute
    // A^T A = [[2, 1], [1, 2]], inverse = 1/3 × [[2, -1], [-1, 2]]
    const Qxx = [[2/3, -1/3], [-1/3, 2/3]]
    const QvvDiag = computeQvvDiagonal(A, W, Qxx)

    // Redundancy = sum(W[i] × QvvDiag[i])
    const redundancy = QvvDiag.reduce((sum, q, i) => sum + W[i] * q, 0)
    // dof = m - n = 3 - 2 = 1
    expect(redundancy).toBeCloseTo(1, 4)
  })
})
