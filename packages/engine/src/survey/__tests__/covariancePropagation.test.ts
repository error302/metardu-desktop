/**
 * Tests for Covariance Propagation (WithUncertainty<T>)
 */

import {
  scalar,
  vector,
  coordinate2D,
  coordinate3D,
  certain,
  scalarCI,
  formatScalarWithCI,
  addScalars,
  subtractScalars,
  multiplyScalars,
  divideScalars,
  propagate,
  distance2D,
  polygonArea2D,
  polygonPerimeter2D,
} from '../covariancePropagation'

describe('Constructors', () => {
  it('scalar creates a 1×1 covariance', () => {
    const s = scalar(100, 0.005)
    expect(s.value).toBe(100)
    expect(s.covariance).toEqual([[0.000025]])  // 0.005²
  })

  it('vector creates an n×n covariance', () => {
    const v = vector([1, 2, 3], [[1, 0, 0], [0, 4, 0], [0, 0, 9]])
    expect(v.value).toEqual([1, 2, 3])
    expect(v.covariance[0][0]).toBe(1)
    expect(v.covariance[1][1]).toBe(4)
    expect(v.covariance[2][2]).toBe(9)
  })

  it('coordinate2D creates a 2×2 covariance with cross-covariance', () => {
    const c = coordinate2D(500000, 9900000, 0.005, 0.005, 0.00001)
    expect(c.value.e).toBe(500000)
    expect(c.value.n).toBe(9900000)
    expect(c.covariance[0][0]).toBeCloseTo(0.000025, 8)
    expect(c.covariance[0][1]).toBe(0.00001)
    expect(c.covariance[1][0]).toBe(0.00001)
  })

  it('coordinate3D creates a 3×3 covariance', () => {
    const c = coordinate3D(500000, 9900000, 1500, 0.005, 0.005, 0.010)
    expect(c.value.h).toBe(1500)
    expect(c.covariance[0][0]).toBeCloseTo(0.000025, 8)
    expect(c.covariance[1][1]).toBeCloseTo(0.000025, 8)
    expect(c.covariance[2][2]).toBeCloseTo(0.0001, 8)
  })

  it('certain creates zero covariance', () => {
    const c = certain(42, 1)
    expect(c.value).toBe(42)
    expect(c.covariance[0][0]).toBe(0)
  })
})

describe('Confidence Intervals', () => {
  it('computes 95% CI for a scalar', () => {
    const s = scalar(100, 0.005)
    const ci = scalarCI(s, 0.95)
    expect(ci.mean).toBe(100)
    expect(ci.stdDev).toBeCloseTo(0.005, 6)
    // z(0.975) ≈ 1.96
    expect(ci.halfWidth).toBeCloseTo(1.96 * 0.005, 3)
    expect(ci.lower).toBeCloseTo(100 - 1.96 * 0.005, 3)
    expect(ci.upper).toBeCloseTo(100 + 1.96 * 0.005, 3)
  })

  it('computes 99% CI (wider than 95%)', () => {
    const s = scalar(100, 0.005)
    const ci99 = scalarCI(s, 0.99)
    const ci95 = scalarCI(s, 0.95)
    expect(ci99.halfWidth).toBeGreaterThan(ci95.halfWidth)
  })

  it('formats a scalar with CI for display', () => {
    const s = scalar(1234.5, 0.2, 'traverse adjustment')
    const formatted = formatScalarWithCI(s, { unit: 'm²', decimals: 1 })
    expect(formatted).toContain('1234.5')
    expect(formatted).toContain('±')
    expect(formatted).toContain('m²')
    expect(formatted).toContain('95% CI')
  })
})

describe('Scalar Arithmetic', () => {
  it('adds two independent scalars (variances sum)', () => {
    const a = scalar(10, 0.1)
    const b = scalar(20, 0.2)
    const c = addScalars(a, b)
    expect(c.value).toBe(30)
    expect(c.covariance[0][0]).toBeCloseTo(0.01 + 0.04, 6)  // 0.1² + 0.2²
  })

  it('subtracts two scalars', () => {
    const a = scalar(30, 0.1)
    const b = scalar(10, 0.2)
    const c = subtractScalars(a, b)
    expect(c.value).toBe(20)
    expect(c.covariance[0][0]).toBeCloseTo(0.01 + 0.04, 6)
  })

  it('multiplies two scalars (variance: y²σx² + x²σy²)', () => {
    const a = scalar(2, 0.1)
    const b = scalar(3, 0.2)
    const c = multiplyScalars(a, b)
    expect(c.value).toBe(6)
    // Var = 3²·0.01 + 2²·0.04 = 0.09 + 0.16 = 0.25
    expect(c.covariance[0][0]).toBeCloseTo(0.25, 4)
  })

  it('divides two scalars', () => {
    const a = scalar(6, 0.1)
    const b = scalar(2, 0.1)
    const c = divideScalars(a, b)
    expect(c.value).toBe(3)
    expect(c.covariance[0][0]).toBeGreaterThan(0)
  })

  it('handles correlated scalars', () => {
    const a = scalar(10, 0.1)
    const b = scalar(20, 0.2)
    // Positive correlation increases the sum's variance
    const cPos = addScalars(a, b, 0.02)
    const cIndep = addScalars(a, b, 0)
    expect(cPos.covariance[0][0]).toBeGreaterThan(cIndep.covariance[0][0])
  })
})

describe('Generic Propagation', () => {
  it('propagates uncertainty through a linear function', () => {
    // f(x, y) = 2x + 3y
    const input = vector([1, 2], [[0.01, 0], [0, 0.04]])
    const result = propagate(input, ([x, y]) => [2 * x + 3 * y], 1)
    expect(result.value[0]).toBe(8)  // 2·1 + 3·2 = 8
    // Var = (2²·0.01 + 3²·0.04) = 0.04 + 0.36 = 0.40
    expect(result.covariance[0][0]).toBeCloseTo(0.40, 4)
  })

  it('propagates uncertainty through a non-linear function', () => {
    // f(x, y) = x² + y²
    const input = vector([3, 4], [[0.01, 0], [0, 0.01]])
    const result = propagate(input, ([x, y]) => [x * x + y * y], 1)
    expect(result.value[0]).toBe(25)  // 9 + 16
    // ∂f/∂x = 2x = 6, ∂f/∂y = 2y = 8
    // Var = 6²·0.01 + 8²·0.01 = 0.36 + 0.64 = 1.0
    expect(result.covariance[0][0]).toBeCloseTo(1.0, 1)
  })
})

describe('Surveying-Specific Operations', () => {
  it('computes distance with propagated uncertainty', () => {
    // Two points 100m apart, each with 5mm std dev
    const p1 = coordinate2D(500000, 9900000, 0.005, 0.005)
    const p2 = coordinate2D(500100, 9900000, 0.005, 0.005)
    const d = distance2D(p1, p2)

    expect(d.value).toBeCloseTo(100, 4)
    // Distance variance ≈ 2·σ² (for two equal-accuracy points at the same y)
    // Var = (∂d/∂E1)²·σ² + (∂d/∂E2)²·σ² = (-1)²·0.000025 + (1)²·0.000025 = 0.00005
    expect(d.covariance[0][0]).toBeCloseTo(0.00005, 5)
  })

  it('computes polygon area with propagated uncertainty', () => {
    // A 100m × 100m square (area = 10000 m²)
    const vertices = [
      coordinate2D(500000, 9900000, 0.005, 0.005),
      coordinate2D(500100, 9900000, 0.005, 0.005),
      coordinate2D(500100, 9900100, 0.005, 0.005),
      coordinate2D(500000, 9900100, 0.005, 0.005),
    ]
    const area = polygonArea2D(vertices)

    expect(area.value).toBeCloseTo(10000, 1)
    expect(area.covariance[0][0]).toBeGreaterThan(0)
  })

  it('computes polygon perimeter with propagated uncertainty', () => {
    const vertices = [
      coordinate2D(500000, 9900000, 0.005, 0.005),
      coordinate2D(500100, 9900000, 0.005, 0.005),
      coordinate2D(500100, 9900100, 0.005, 0.005),
      coordinate2D(500000, 9900100, 0.005, 0.005),
    ]
    const perim = polygonPerimeter2D(vertices)

    expect(perim.value).toBeCloseTo(400, 1)  // 4 × 100m
    expect(perim.covariance[0][0]).toBeGreaterThan(0)
  })

  it('area uncertainty scales with vertex uncertainty', () => {
    // Same polygon, but vertices have 10× larger uncertainty
    const vertices1 = [
      coordinate2D(500000, 9900000, 0.005, 0.005),
      coordinate2D(500100, 9900000, 0.005, 0.005),
      coordinate2D(500100, 9900100, 0.005, 0.005),
      coordinate2D(500000, 9900100, 0.005, 0.005),
    ]
    const vertices2 = [
      coordinate2D(500000, 9900000, 0.05, 0.05),
      coordinate2D(500100, 9900000, 0.05, 0.05),
      coordinate2D(500100, 9900100, 0.05, 0.05),
      coordinate2D(500000, 9900100, 0.05, 0.05),
    ]
    const area1 = polygonArea2D(vertices1)
    const area2 = polygonArea2D(vertices2)

    // 10× larger σ → 100× larger variance
    expect(area2.covariance[0][0] / area1.covariance[0][0]).toBeCloseTo(100, 0)
  })
})

describe('Real-World Surveying Scenario', () => {
  it('computes deed plan area with CI for a 4-vertex parcel', () => {
    // A typical 0.5 hectare parcel (50m × 100m) with 5mm traverse accuracy
    const vertices = [
      coordinate2D(500000, 9900000, 0.005, 0.005),
      coordinate2D(500050, 9900000, 0.005, 0.005),
      coordinate2D(500050, 9900100, 0.005, 0.005),
      coordinate2D(500000, 9900100, 0.005, 0.005),
    ]
    const area = polygonArea2D(vertices)

    // Area should be 5000 m²
    expect(area.value).toBeCloseTo(5000, 1)

    // Format with CI
    const formatted = formatScalarWithCI(area, { unit: 'm²', decimals: 2 })
    expect(formatted).toContain('5000')
    expect(formatted).toContain('±')
    expect(formatted).toContain('m²')
    expect(formatted).toContain('95% CI')
  })
})
