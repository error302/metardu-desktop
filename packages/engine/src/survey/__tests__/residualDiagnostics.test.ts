/**
 * Tests for the Residual Diagnostics module
 * (Kolmogorov-Smirnov, Anderson-Darling, Durbin-Watson, moments)
 */

import {
  computeMoments,
  kolmogorovSmirnovTest,
  andersonDarlingTest,
  durbinWatsonTest,
  computeResidualDiagnostics,
} from '../residualDiagnostics'

// ─── Moments ────────────────────────────────────────────────────────────────

describe('computeMoments', () => {
  it('computes mean and standard deviation correctly', () => {
    const residuals = [1, 2, 3, 4, 5]
    const m = computeMoments(residuals)
    expect(m.mean).toBeCloseTo(3, 10)
    expect(m.standardDeviation).toBeCloseTo(Math.sqrt(2), 6)
    expect(m.n).toBe(5)
  })

  it('skewness is zero for a symmetric distribution', () => {
    const residuals = [-2, -1, 0, 1, 2]
    const m = computeMoments(residuals)
    expect(m.skewness).toBeCloseTo(0, 6)
  })

  it('excess kurtosis is zero for a normal-like distribution', () => {
    // Generate approximate normal samples using Box-Muller with random inputs
    const n = 10000
    const residuals: number[] = []
    // Use a fixed seed for reproducibility
    let seed = 12345
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let i = 0; i < n; i++) {
      const u1 = Math.max(1e-10, random())
      const u2 = random()
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
      residuals.push(z)
    }
    const m = computeMoments(residuals)
    expect(m.skewness).toBeCloseTo(0, 1)
    expect(m.kurtosis).toBeCloseTo(0, 1)
  })

  it('positive skewness for a right-skewed distribution', () => {
    const residuals = [0, 0, 0, 0, 0, 1, 2, 3, 10]
    const m = computeMoments(residuals)
    expect(m.skewness).toBeGreaterThan(0.5)
  })

  it('handles empty array', () => {
    const m = computeMoments([])
    expect(m.n).toBe(0)
    expect(m.mean).toBe(0)
  })
})

// ─── Kolmogorov-Smirnov Test ────────────────────────────────────────────────

describe('kolmogorovSmirnovTest', () => {
  it('passes for normal residuals', () => {
    // Generate ~200 normally-distributed residuals using Box-Muller
    const residuals: number[] = []
    let seed = 42
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let i = 0; i < 200; i++) {
      const u1 = Math.max(1e-10, random())
      const u2 = random()
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
      residuals.push(z)
    }
    const result = kolmogorovSmirnovTest(residuals)
    expect(result.passed).toBe(true)
    expect(result.statistic).toBeLessThan(result.criticalValue)
  })

  it('fails for heavily skewed residuals', () => {
    // Bimodal residuals (definitely not normal)
    const residuals = [
      -5, -5, -5, -5, -5, -5, -5, -5, -5, -5,
       5,  5,  5,  5,  5,  5,  5,  5,  5,  5,
    ]
    const result = kolmogorovSmirnovTest(residuals)
    expect(result.passed).toBe(false)
  })

  it('returns inconclusive for small samples', () => {
    const result = kolmogorovSmirnovTest([1, 2, 3])
    expect(result.interpretation).toContain('too small')
  })

  it('handles zero-variance residuals', () => {
    const result = kolmogorovSmirnovTest([5, 5, 5, 5, 5])
    expect(result.passed).toBe(true)
    expect(result.interpretation).toContain('zero variance')
  })
})

// ─── Anderson-Darling Test ──────────────────────────────────────────────────

describe('andersonDarlingTest', () => {
  it('passes for normal residuals', () => {
    const residuals: number[] = []
    let seed = 99
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let i = 0; i < 200; i++) {
      const u1 = Math.max(1e-10, random())
      const u2 = random()
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
      residuals.push(z)
    }
    const result = andersonDarlingTest(residuals)
    expect(result.passed).toBe(true)
  })

  it('fails for heavy-tailed residuals', () => {
    // Heavy-tailed: mostly small values with a few large outliers
    const residuals = [
      -0.1, 0.1, -0.05, 0.05, -0.2, 0.2, 0, 0, 0, 0,
      15, -15,  // extreme outliers
    ]
    const result = andersonDarlingTest(residuals)
    expect(result.passed).toBe(false)
  })

  it('returns inconclusive for small samples', () => {
    const result = andersonDarlingTest([1, 2, 3, 4, 5])
    expect(result.interpretation).toContain('too small')
  })
})

// ─── Durbin-Watson Test ─────────────────────────────────────────────────────

describe('durbinWatsonTest', () => {
  it('DW ≈ 2 for uncorrelated residuals', () => {
    // Generate uncorrelated residuals
    const residuals: number[] = []
    let lastVal = 0
    for (let i = 0; i < 100; i++) {
      // Each residual is independent of the previous
      const z = (Math.random() - 0.5) * 2
      residuals.push(z)
      lastVal = z
    }
    const result = durbinWatsonTest(residuals)
    expect(result.statistic).toBeGreaterThan(1.5)
    expect(result.statistic).toBeLessThan(2.5)
  })

  it('DW < 2 for positively autocorrelated residuals', () => {
    // Strongly positively autocorrelated: each residual is close to the previous
    const residuals: number[] = []
    let val = 0
    for (let i = 0; i < 50; i++) {
      val += (Math.random() - 0.5) * 0.1  // slow random walk
      residuals.push(val)
    }
    const result = durbinWatsonTest(residuals)
    expect(result.statistic).toBeLessThan(1.0)
    expect(result.conclusion).toBe('positive_autocorrelation')
  })

  it('DW > 2 for negatively autocorrelated residuals', () => {
    // Alternating residuals
    const residuals: number[] = []
    for (let i = 0; i < 50; i++) {
      residuals.push(i % 2 === 0 ? 1 : -1)
    }
    const result = durbinWatsonTest(residuals)
    expect(result.statistic).toBeGreaterThan(3.0)
  })

  it('returns inconclusive for small samples', () => {
    const result = durbinWatsonTest([1, 2, 3, 4, 5])
    expect(result.conclusion).toBe('inconclusive')
  })
})

// ─── Full Diagnostics ───────────────────────────────────────────────────────

describe('computeResidualDiagnostics', () => {
  it('passes for clean normal residuals', () => {
    const residuals: number[] = []
    let seed = 7
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let i = 0; i < 200; i++) {
      const u1 = Math.max(1e-10, random())
      const u2 = random()
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
      residuals.push(z)
    }
    const result = computeResidualDiagnostics(residuals, { includeDurbinWatson: true })
    expect(result.passed).toBe(true)
    expect(result.summary).toContain('PASS')
  })

  it('flags non-normal residuals with warnings', () => {
    const residuals = [
      -5, -5, -5, -5, -5, -5, -5, -5, -5, -5,
       5,  5,  5,  5,  5,  5,  5,  5,  5,  5,
    ]
    const result = computeResidualDiagnostics(residuals)
    expect(result.passed).toBe(false)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.summary).toContain('FAIL')
  })

  it('includes all sub-tests when requested', () => {
    const residuals: number[] = []
    for (let i = 0; i < 50; i++) {
      residuals.push((Math.random() - 0.5) * 2)
    }
    const result = computeResidualDiagnostics(residuals, { includeDurbinWatson: true })
    expect(result.kolmogorovSmirnov).toBeDefined()
    expect(result.andersonDarling).toBeDefined()
    expect(result.durbinWatson).toBeDefined()
    expect(result.moments).toBeDefined()
  })
})
