/**
 * Tests for Total Least Squares (TLS)
 */

import { computeStandardTLS, computeWeightedTLS } from '../totalLeastSquares'

describe('computeStandardTLS', () => {
  test('recovers exact solution when no errors', () => {
    // Build a 5×3 system A·x = l where x = [1, 2, 3]
    const x_true = [1, 2, 3]
    const A = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 0],
      [0, 1, 1],
    ]
    const l = A.map(row => row.reduce((s, a, j) => s + a * x_true[j], 0))
    // l = [1, 2, 3, 3, 5]

    const result = computeStandardTLS({ A, l })

    expect(result.x[0]).toBeCloseTo(1, 4)
    expect(result.x[1]).toBeCloseTo(2, 4)
    expect(result.x[2]).toBeCloseTo(3, 4)
    expect(result.residuals.every(r => Math.abs(r) < 0.01)).toBe(true)
  })

  test('handles overdetermined system with noise on both A and l', () => {
    // Linear regression: y = 1 + 2x with noise on BOTH A and l
    // (This is the TLS sweet spot — when A also has errors)
    const x_true = [1, 2]
    const A = [
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [1, 5],
      [1, 6],
    ]
    const l_clean = A.map(row => row.reduce((s, a, j) => s + a * x_true[j], 0))
    // l_clean = [3, 5, 7, 9, 11, 13]

    // Add small noise to both A and l
    const A_noisy = A.map(([a, b], i) => [a + (i * 0.001 - 0.003), b + (i * 0.002 - 0.006)])
    const l = l_clean.map((v, i) => v + (i * 0.005 - 0.015))

    const result = computeStandardTLS({ A: A_noisy, l })

    // TLS should recover x approximately (within ~5% of the true values)
    expect(Math.abs(result.x[0] - 1)).toBeLessThan(0.1)
    expect(Math.abs(result.x[1] - 2)).toBeLessThan(0.1)
  })

  test('computes corrections to A and l', () => {
    const A = [
      [1, 0],
      [0, 1],
      [1, 1],
    ]
    const l = [1.01, 1.99, 3.02]  // roughly A·[1, 2] = [1, 2, 3] with small noise

    const result = computeStandardTLS({ A, l })

    expect(result.deltaA).toHaveLength(3)
    expect(result.deltal).toHaveLength(3)
    expect(result.A_adjusted).toHaveLength(3)
    expect(result.l_adjusted).toHaveLength(3)
  })

  test('computes σ₀ and Qxx', () => {
    const A = [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ]
    const l = [1, 2, 3, -1]

    const result = computeStandardTLS({ A, l })

    expect(result.sigmaZero).toBeGreaterThanOrEqual(0)
    expect(result.degreesOfFreedom).toBe(2)  // 4 - 2
    expect(result.Qxx).toHaveLength(2)
    expect(result.Qxx[0]).toHaveLength(2)
  })

  test('falls back to LS when system is degenerate', () => {
    // All-zero A → singular
    const A = [
      [0, 0],
      [0, 0],
      [0, 0],
    ]
    const l = [1, 2, 3]

    const result = computeStandardTLS({ A, l })
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.method).toBe('standard_ls_fallback')
  })
})

describe('computeWeightedTLS', () => {
  test('recovers exact solution with uniform weights', () => {
    const x_true = [1, 2]
    const A = [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ]
    const l = A.map(row => row.reduce((s, a, j) => s + a * x_true[j], 0))

    const result = computeWeightedTLS({ A, l })

    expect(result.x[0]).toBeCloseTo(1, 4)
    expect(result.x[1]).toBeCloseTo(2, 4)
  })

  test('handles non-uniform weights', () => {
    const x_true = [1, 2]
    const A = [
      [1, 0],
      [0, 1],
      [1, 1],
    ]
    const l = A.map(row => row.reduce((s, a, j) => s + a * x_true[j], 0))
    // Weight the first observation heavily
    const l_weights = [10, 1, 1]

    const result = computeWeightedTLS({ A, l, l_weights })

    expect(result.x[0]).toBeCloseTo(1, 2)
    expect(result.x[1]).toBeCloseTo(2, 2)
  })

  test('iterates to convergence', () => {
    const A = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 0],
      [0, 1, 1],
    ]
    const l = [1.001, 2.002, 2.998, 3.003, 5.001]

    const result = computeWeightedTLS({ A, l })

    expect(result.method).toBe('iterative_wtls')
    expect(result.x[0]).toBeCloseTo(1, 2)
    expect(result.x[1]).toBeCloseTo(2, 2)
    expect(result.x[2]).toBeCloseTo(3, 2)
  })

  test('returns method metadata', () => {
    const A = [[1, 0], [0, 1], [1, 1]]
    const l = [1, 2, 3]

    const result = computeWeightedTLS({ A, l })

    expect(result.method).toBe('iterative_wtls')
    expect(typeof result.iterations).toBe('number')
  })
})
