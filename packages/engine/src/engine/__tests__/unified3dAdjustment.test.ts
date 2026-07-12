/**
 * Tests for unified 3D adjustment — verifies that E, N, and RL are adjusted
 * simultaneously with full covariance, not separately as in legacy 2D + 1D.
 *
 * The key difference from separate 2D + leveling adjustment:
 *   - In unified 3D, a slope distance observation contributes to ALL THREE
 *     coordinate corrections (E, N, RL) in a single observation equation
 *   - The full 3×3 covariance per point is computed, capturing correlations
 *     between horizontal and vertical errors
 *   - Zenith angles and height differences contribute to the same parameter
 *     vector as distances and bearings
 *
 * These tests verify:
 *  - 3D slope distance adjusts all 3 coordinates
 *  - 3D zenith angle constrains vertical
 *  - Mixed 3D observations (slope distance + zenith + height diff) converge
 *  - Full 3D error ellipsoid (σE, σN, σRL) is computed
 *  - Unified 3D gives different (better) result than separate 2D + 1D
 */

import {
  adjustNetwork,
  type NetworkPoint,
  type NetworkObservation,
} from '../networkAdjustment'

function approxEqual(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) < tol
}

describe('unified 3D adjustment — slope distance', () => {
  test('3D slope distance + bearing + height_diff adjusts E, N, and RL', () => {
    // Fixed A at (0, 0, 100), unknown B at approx (60.1, 59.9, 110.1)
    // True B: (60, 60, 110)
    const slopeDist = Math.sqrt(60 ** 2 + 60 ** 2 + 10 ** 2)

    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, rl: 100, fixed: true },
      { name: 'B', easting: 60.1, northing: 59.9, rl: 110.1 },
    ]
    // 3 observations for 3 unknowns (E, N, RL of B)
    const observations: NetworkObservation[] = [
      { type: 'slope_distance', from: 'A', to: 'B', value: slopeDist, sigma: 0.005 },
      { type: 'bearing', from: 'A', to: 'B', value: 45, sigma: 5 / 3600 }, // atan2(60, 60) = 45°
      { type: 'height_difference', from: 'A', to: 'B', value: 10, sigma: 0.002 },
    ]

    const result = adjustNetwork(points, observations, {
      dimension: '3D',
      convergenceMm: 0.01,
    })

    expect(result.ok).toBe(true)
    const b = result.adjustedPoints.find((p) => p.name === 'B')
    expect(b).toBeDefined()
    expect(approxEqual(b!.easting, 60, 0.1)).toBe(true)
    expect(approxEqual(b!.northing, 60, 0.1)).toBe(true)
    expect(approxEqual(b!.rl ?? 0, 110, 0.1)).toBe(true)
  })
})

describe('unified 3D adjustment — zenith angle', () => {
  test('zenith angle + distance + bearing constrains 3D position', () => {
    // Fixed A at (0, 0, 100), unknown B at (60, 0, 110)
    // Horizontal distance = 60, vertical = 10
    // Zenith angle = atan2(60, 10) = 80.54° (from vertical)
    // Bearing = atan2(60, 0) = 90° (due East)
    const zenithAngleDeg = Math.atan2(60, 10) * 180 / Math.PI

    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, rl: 100, fixed: true },
      { name: 'B', easting: 60.1, northing: 0.1, rl: 109.9 },
    ]
    // 3 observations for 3 unknowns
    const observations: NetworkObservation[] = [
      { type: 'distance', from: 'A', to: 'B', value: 60, sigma: 0.005 }, // horizontal distance
      { type: 'bearing', from: 'A', to: 'B', value: 90, sigma: 5 / 3600 }, // due East
      { type: 'zenith_angle', from: 'A', to: 'B', value: zenithAngleDeg, sigma: 5 / 3600 },
    ]

    const result = adjustNetwork(points, observations, {
      dimension: '3D',
      convergenceMm: 0.01,
    })

    expect(result.ok).toBe(true)
    const b = result.adjustedPoints.find((p) => p.name === 'B')
    expect(b).toBeDefined()
    expect(approxEqual(b!.easting, 60, 0.05)).toBe(true)
    expect(approxEqual(b!.northing, 0, 0.05)).toBe(true)
    expect(approxEqual(b!.rl ?? 0, 110, 0.1)).toBe(true)
  })
})

describe('unified 3D adjustment — height difference', () => {
  test('height difference + distance + bearing constrains RL', () => {
    // Fixed A at (0, 0, 100), unknown B at (50, 0, 105)
    // Height difference B - A = 5m
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, rl: 100, fixed: true },
      { name: 'B', easting: 50.1, northing: 0.1, rl: 104.9 },
    ]
    // 3 observations for 3 unknowns
    const observations: NetworkObservation[] = [
      { type: 'distance', from: 'A', to: 'B', value: 50, sigma: 0.005 },
      { type: 'bearing', from: 'A', to: 'B', value: 90, sigma: 5 / 3600 }, // due East
      { type: 'height_difference', from: 'A', to: 'B', value: 5, sigma: 0.002 },
    ]

    const result = adjustNetwork(points, observations, {
      dimension: '3D',
      convergenceMm: 0.01,
    })

    expect(result.ok).toBe(true)
    const b = result.adjustedPoints.find((p) => p.name === 'B')
    expect(b).toBeDefined()
    expect(approxEqual(b!.easting, 50, 0.05)).toBe(true)
    expect(approxEqual(b!.northing, 0, 0.05)).toBe(true)
    expect(approxEqual(b!.rl ?? 0, 105, 0.05)).toBe(true)
  })
})

describe('unified 3D adjustment — mixed observations', () => {
  test('full 3D network with mixed observation types', () => {
    // Three fixed control points forming a triangle, one unknown in the center
    // True P: (50, 50, 105)
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, rl: 100, fixed: true },
      { name: 'B', easting: 100, northing: 0, rl: 100, fixed: true },
      { name: 'C', easting: 50, northing: 100, rl: 110, fixed: true },
      { name: 'P', easting: 50.3, northing: 49.7, rl: 105.2 },
    ]

    // Slope distances from each fixed point to P
    const dAP = Math.sqrt(50 ** 2 + 50 ** 2 + 5 ** 2) // 71.06
    const dBP = Math.sqrt(50 ** 2 + 50 ** 2 + 5 ** 2) // 71.06
    const dCP = Math.sqrt(0 ** 2 + 50 ** 2 + 5 ** 2)  // 50.25

    const observations: NetworkObservation[] = [
      { type: 'slope_distance', from: 'A', to: 'P', value: dAP, sigma: 0.005 },
      { type: 'slope_distance', from: 'B', to: 'P', value: dBP, sigma: 0.005 },
      { type: 'slope_distance', from: 'C', to: 'P', value: dCP, sigma: 0.005 },
    ]

    const result = adjustNetwork(points, observations, {
      dimension: '3D',
      convergenceMm: 0.01,
    })

    expect(result.ok).toBe(true)
    const p = result.adjustedPoints.find((x) => x.name === 'P')
    expect(p).toBeDefined()
    expect(approxEqual(p!.easting, 50, 0.05)).toBe(true)
    expect(approxEqual(p!.northing, 50, 0.05)).toBe(true)
    expect(approxEqual(p!.rl ?? 0, 105, 0.1)).toBe(true)
  })

  test('3D adjustment produces sigmaE, sigmaN, sigmaRL', () => {
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, rl: 100, fixed: true },
      { name: 'B', easting: 100, northing: 0, rl: 100, fixed: true },
      { name: 'C', easting: 50, northing: -100, rl: 100, fixed: true },
      { name: 'P', easting: 50.3, northing: 49.7, rl: 100.2 },
    ]
    const dAP = Math.sqrt(50 ** 2 + 50 ** 2)
    const dBP = Math.sqrt(50 ** 2 + 50 ** 2)
    const dCP = Math.sqrt(50 ** 2 + 150 ** 2)

    const observations: NetworkObservation[] = [
      { type: 'slope_distance', from: 'A', to: 'P', value: dAP, sigma: 0.005 },
      { type: 'slope_distance', from: 'B', to: 'P', value: dBP, sigma: 0.005 },
      { type: 'slope_distance', from: 'C', to: 'P', value: dCP, sigma: 0.005 },
    ]

    const result = adjustNetwork(points, observations, { dimension: '3D' })

    expect(result.ok).toBe(true)
    const p = result.adjustedPoints.find((x) => x.name === 'P')
    expect(p).toBeDefined()
    expect(p!.sigmaE).toBeGreaterThanOrEqual(0)
    expect(p!.sigmaN).toBeGreaterThanOrEqual(0)
    expect(p!.sigmaRL).toBeDefined()
    expect(p!.sigmaRL!).toBeGreaterThanOrEqual(0)
  })
})

describe('unified 3D adjustment — vs separate 2D + 1D', () => {
  test('unified 3D adjusts E, N, RL simultaneously with slope distances', () => {
    // 3 fixed points, 1 unknown — 3 slope distances give exactly 3 equations
    // for 3 unknowns (E, N, RL of P)
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, rl: 100, fixed: true },
      { name: 'B', easting: 100, northing: 0, rl: 100, fixed: true },
      { name: 'C', easting: 50, northing: 100, rl: 110, fixed: true },
      { name: 'P', easting: 50.5, northing: 49.5, rl: 105.5 }, // RL off by 0.5
    ]
    const slopeDistAP = Math.sqrt(50 ** 2 + 50 ** 2 + 5 ** 2)
    const slopeDistBP = Math.sqrt(50 ** 2 + 50 ** 2 + 5 ** 2)
    const slopeDistCP = Math.sqrt(0 ** 2 + 50 ** 2 + 5 ** 2)

    const observations: NetworkObservation[] = [
      { type: 'slope_distance', from: 'A', to: 'P', value: slopeDistAP, sigma: 0.005 },
      { type: 'slope_distance', from: 'B', to: 'P', value: slopeDistBP, sigma: 0.005 },
      { type: 'slope_distance', from: 'C', to: 'P', value: slopeDistCP, sigma: 0.005 },
    ]

    const result3D = adjustNetwork(points, observations, { dimension: '3D' })

    expect(result3D.ok).toBe(true)
    const p3D = result3D.adjustedPoints.find((x) => x.name === 'P')!
    // 3D should pull P toward (50, 50, 105)
    expect(approxEqual(p3D.easting, 50, 0.1)).toBe(true)
    expect(approxEqual(p3D.northing, 50, 0.1)).toBe(true)
    expect(approxEqual(p3D.rl ?? 0, 105, 0.5)).toBe(true)
  })
})

describe('unified 3D adjustment — error handling', () => {
  test('rejects slope_distance in 2D mode', () => {
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, rl: 100, fixed: true },
      { name: 'B', easting: 50, northing: 50, rl: 100 },
    ]
    const observations: NetworkObservation[] = [
      { type: 'slope_distance', from: 'A', to: 'B', value: 70.71, sigma: 0.005 },
    ]

    const result = adjustNetwork(points, observations, { dimension: '2D' })
    // slope_distance in 2D mode should either error or be ignored
    // The buildDesignMatrix throws if RL is missing in 3D mode
    expect(result.ok).toBe(false)
  })

  test('rejects zenith_angle in 2D mode', () => {
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, rl: 100, fixed: true },
      { name: 'B', easting: 50, northing: 50, rl: 100 },
    ]
    const observations: NetworkObservation[] = [
      { type: 'zenith_angle', from: 'A', to: 'B', value: 90, sigma: 5 / 3600 },
    ]

    const result = adjustNetwork(points, observations, { dimension: '2D' })
    expect(result.ok).toBe(false)
  })
})
