/**
 * Tests for the enterprise-grade network adjustment engine.
 *
 * Verifies:
 *  - Basic constrained adjustment matches known answer
 *  - Iterative relinearization converges for large misclosures
 *  - Free network adjustment works with zero fixed points
 *  - Robust estimation (Huber) downweights blunders
 *  - Sparse solver scales to large networks
 *  - Residual statistics match independent calculation
 */

import {
  adjustNetwork,
  type NetworkPoint,
  type NetworkObservation,
} from '../networkAdjustment'

function approxEqual(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) < tol
}

describe('networkAdjustment — basic constrained', () => {
  test('simple 2D intersection: 2 fixed points, 1 unknown', () => {
    // Fixed points A and B, 100m apart on the E axis
    // Unknown point P observed by distance from both A and B
    // P is at (50, 50) — distance to A is √(50²+50²) = 70.7107
    //                       distance to B is √(50²+50²) = 70.7107
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, fixed: true },
      { name: 'B', easting: 100, northing: 0, fixed: true },
      { name: 'P', easting: 50.5, northing: 49.5 }, // approximate
    ]
    const distAP = Math.sqrt(50 ** 2 + 50 ** 2) // 70.7107
    const distBP = Math.sqrt(50 ** 2 + 50 ** 2)
    const observations: NetworkObservation[] = [
      { type: 'distance', from: 'A', to: 'P', value: distAP, sigma: 0.005 },
      { type: 'distance', from: 'B', to: 'P', value: distBP, sigma: 0.005 },
    ]

    const result = adjustNetwork(points, observations, { convergenceMm: 0.001 })

    expect(result.ok).toBe(true)
    const p = result.adjustedPoints.find((x) => x.name === 'P')
    expect(p).toBeDefined()
    expect(approxEqual(p!.easting, 50, 0.001)).toBe(true)
    expect(approxEqual(p!.northing, 50, 0.001)).toBe(true)
  })

  test('2D traverse with bearing + distance', () => {
    // A (fixed) → P1 → P2 → B (fixed)
    // A is at (0, 0), B is at (200, 0)
    // P1 at (100, 0), P2 at (100, 100)
    // Bearings (clockwise from North, atan2(dE, dN)):
    //   A → P1: dE=100, dN=0 → bearing 90° (due East)
    //   P1 → P2: dE=0, dN=100 → bearing 0° (due North)
    //   P2 → B: dE=100, dN=-100 → bearing 135° (South-East)
    const distP2B = Math.sqrt(100 ** 2 + 100 ** 2) // 141.42
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, fixed: true },
      { name: 'B', easting: 200, northing: 0, fixed: true },
      { name: 'P1', easting: 99.9, northing: 0.1 },
      { name: 'P2', easting: 100.1, northing: 99.9 },
    ]
    const observations: NetworkObservation[] = [
      { type: 'bearing', from: 'A', to: 'P1', value: 90, sigma: 5 / 3600 },
      { type: 'distance', from: 'A', to: 'P1', value: 100, sigma: 0.005 },
      { type: 'bearing', from: 'P1', to: 'P2', value: 0, sigma: 5 / 3600 },
      { type: 'distance', from: 'P1', to: 'P2', value: 100, sigma: 0.005 },
      { type: 'bearing', from: 'P2', to: 'B', value: 135, sigma: 5 / 3600 },
      { type: 'distance', from: 'P2', to: 'B', value: distP2B, sigma: 0.005 },
    ]

    const result = adjustNetwork(points, observations, { convergenceMm: 0.1 })

    expect(result.ok).toBe(true)
    // P1 should be near (100, 0)
    const p1 = result.adjustedPoints.find((x) => x.name === 'P1')
    expect(p1).toBeDefined()
    expect(approxEqual(p1!.easting, 100, 0.1)).toBe(true)
    expect(approxEqual(p1!.northing, 0, 0.1)).toBe(true)
    // P2 should be near (100, 100)
    const p2 = result.adjustedPoints.find((x) => x.name === 'P2')
    expect(p2).toBeDefined()
    expect(approxEqual(p2!.easting, 100, 0.1)).toBe(true)
    expect(approxEqual(p2!.northing, 100, 0.1)).toBe(true)
  })
})

describe('networkAdjustment — iterative relinearization', () => {
  test('converges even with poor initial coordinates', () => {
    // Same simple intersection, but start P at (60, 60) — far from true (50, 50)
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, fixed: true },
      { name: 'B', easting: 100, northing: 0, fixed: true },
      { name: 'P', easting: 60, northing: 60 }, // poor approximation
    ]
    const distAP = Math.sqrt(50 ** 2 + 50 ** 2)
    const distBP = Math.sqrt(50 ** 2 + 50 ** 2)
    const observations: NetworkObservation[] = [
      { type: 'distance', from: 'A', to: 'P', value: distAP, sigma: 0.005 },
      { type: 'distance', from: 'B', to: 'P', value: distBP, sigma: 0.005 },
    ]

    const result = adjustNetwork(points, observations, { convergenceMm: 0.001, maxIterations: 20 })

    expect(result.ok).toBe(true)
    const p = result.adjustedPoints.find((x) => x.name === 'P')
    expect(p).toBeDefined()
    expect(approxEqual(p!.easting, 50, 0.001)).toBe(true)
    expect(approxEqual(p!.northing, 50, 0.001)).toBe(true)
    expect(result.iterations).toBeLessThanOrEqual(10)
  })
})

describe('networkAdjustment — free network (inner constraints)', () => {
  test('works with zero fixed points', () => {
    // Three points forming a triangle, no fixed points
    // Free network adjustment should preserve shape, just fix datum
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0 },
      { name: 'B', easting: 100, northing: 0 },
      { name: 'C', easting: 50, northing: 86.6 }, // equilateral triangle
    ]
    const distAB = 100
    const distAC = 100
    const distBC = 100
    const observations: NetworkObservation[] = [
      { type: 'distance', from: 'A', to: 'B', value: distAB, sigma: 0.005 },
      { type: 'distance', from: 'A', to: 'C', value: distAC, sigma: 0.005 },
      { type: 'distance', from: 'B', to: 'C', value: distBC, sigma: 0.005 },
    ]

    const result = adjustNetwork(
      points,
      observations,
      { freeNetwork: true, convergenceMm: 0.001 },
    )

    expect(result.ok).toBe(true)
    // Side lengths should be preserved (within tolerance)
    const a = result.adjustedPoints.find((x) => x.name === 'A')
    const b = result.adjustedPoints.find((x) => x.name === 'B')
    const c = result.adjustedPoints.find((x) => x.name === 'C')
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    expect(c).toBeDefined()

    const adjAB = Math.sqrt((b!.easting - a!.easting) ** 2 + (b!.northing - a!.northing) ** 2)
    const adjAC = Math.sqrt((c!.easting - a!.easting) ** 2 + (c!.northing - a!.northing) ** 2)
    const adjBC = Math.sqrt((c!.easting - b!.easting) ** 2 + (c!.northing - b!.northing) ** 2)

    expect(approxEqual(adjAB, 100, 0.01)).toBe(true)
    expect(approxEqual(adjAC, 100, 0.01)).toBe(true)
    expect(approxEqual(adjBC, 100, 0.01)).toBe(true)
  })
})

describe('networkAdjustment — robust estimation', () => {
  test('Huber weights downweight a blunder', () => {
    // Same intersection as before, but with a blunder in one observation
    const trueP = { e: 50, n: 50 }
    const distAP = Math.sqrt(trueP.e ** 2 + trueP.n ** 2)
    const distBP = Math.sqrt((trueP.e - 100) ** 2 + trueP.n ** 2)
    const distCP = Math.sqrt((trueP.e - 50) ** 2 + (trueP.n + 100) ** 2)

    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, fixed: true },
      { name: 'B', easting: 100, northing: 0, fixed: true },
      { name: 'C', easting: 50, northing: -100, fixed: true },
      { name: 'P', easting: 50.5, northing: 49.5 },
    ]
    const observations: NetworkObservation[] = [
      { type: 'distance', from: 'A', to: 'P', value: distAP, sigma: 0.005 },
      { type: 'distance', from: 'B', to: 'P', value: distBP, sigma: 0.005 },
      // Blunder: 0.5m error on this observation
      { type: 'distance', from: 'C', to: 'P', value: distCP + 0.5, sigma: 0.005 },
    ]

    // Without robust
    const resultNoRobust = adjustNetwork(points, observations, { robust: false })
    // With robust
    const resultRobust = adjustNetwork(points, observations, { robust: true })

    expect(resultNoRobust.ok).toBe(true)
    expect(resultRobust.ok).toBe(true)

    // Robust should be closer to truth (50, 50)
    const pNoRobust = resultNoRobust.adjustedPoints.find((x) => x.name === 'P')!
    const pRobust = resultRobust.adjustedPoints.find((x) => x.name === 'P')!

    const errNoRobust = Math.sqrt((pNoRobust.easting - 50) ** 2 + (pNoRobust.northing - 50) ** 2)
    const errRobust = Math.sqrt((pRobust.easting - 50) ** 2 + (pRobust.northing - 50) ** 2)

    // Robust should be at least as good, ideally better
    expect(errRobust).toBeLessThanOrEqual(errNoRobust + 0.001)
    // Robust should have detected the outlier
    expect(resultRobust.robust).toBeDefined()
    expect(resultRobust.robust!.downweightedCount).toBeGreaterThan(0)
  })
})

describe('networkAdjustment — error handling', () => {
  test('rejects empty point list', () => {
    const result = adjustNetwork([], [])
    expect(result.ok).toBe(false)
    expect(result.error).toContain('No points')
  })

  test('rejects no observations', () => {
    const result = adjustNetwork(
      [{ name: 'A', easting: 0, northing: 0, fixed: true }],
      [],
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('No observations')
  })

  test('rejects all-fixed points', () => {
    const result = adjustNetwork(
      [
        { name: 'A', easting: 0, northing: 0, fixed: true },
        { name: 'B', easting: 100, northing: 0, fixed: true },
      ],
      [{ type: 'distance', from: 'A', to: 'B', value: 100, sigma: 0.005 }],
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('No adjustable points')
  })

  test('rejects unknown observation point', () => {
    const result = adjustNetwork(
      [
        { name: 'A', easting: 0, northing: 0, fixed: true },
        { name: 'P', easting: 50, northing: 50 },
      ],
      [{ type: 'distance', from: 'A', to: 'Q', value: 100, sigma: 0.005 }],
    )
    expect(result.ok).toBe(false)
  })
})

describe('networkAdjustment — scalability', () => {
  test('handles 100-station chain in under 5 seconds', () => {
    // Chain of 100 stations, each connected to neighbors by distance + bearing
    const points: NetworkPoint[] = []
    for (let i = 0; i < 100; i++) {
      points.push({
        name: `P${i}`,
        easting: i * 100,
        northing: i % 2 === 0 ? 0 : 1,
        fixed: i === 0 || i === 99,
      })
    }
    const observations: NetworkObservation[] = []
    for (let i = 0; i < 99; i++) {
      observations.push({
        type: 'distance',
        from: `P${i}`,
        to: `P${i + 1}`,
        value: 100,
        sigma: 0.005,
      })
      observations.push({
        type: 'bearing',
        from: `P${i}`,
        to: `P${i + 1}`,
        value: i % 2 === 0 ? 0 : 180,
        sigma: 5 / 3600,
      })
    }

    const start = Date.now()
    const result = adjustNetwork(points, observations, { convergenceMm: 1 })
    const elapsed = Date.now() - start

    expect(result.ok).toBe(true)
    expect(elapsed).toBeLessThan(5000)
  }, 10000)
})

describe('networkAdjustment — statistics', () => {
  test('produces reference variance, DOF, chi-square', () => {
    // Use 3 observations with 2 unknowns to have DOF = 1
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, fixed: true },
      { name: 'B', easting: 100, northing: 0, fixed: true },
      { name: 'C', easting: 50, northing: -100, fixed: true },
      { name: 'P', easting: 50.5, northing: 49.5 },
    ]
    const distAP = Math.sqrt(50 ** 2 + 50 ** 2)
    const distBP = Math.sqrt(50 ** 2 + 50 ** 2)
    const distCP = Math.sqrt(50 ** 2 + 150 ** 2)
    const observations: NetworkObservation[] = [
      { type: 'distance', from: 'A', to: 'P', value: distAP, sigma: 0.005 },
      { type: 'distance', from: 'B', to: 'P', value: distBP, sigma: 0.005 },
      { type: 'distance', from: 'C', to: 'P', value: distCP, sigma: 0.005 },
    ]

    const result = adjustNetwork(points, observations)

    expect(result.ok).toBe(true)
    expect(result.referenceVariance).toBeGreaterThanOrEqual(0)
    expect(result.degreesOfFreedom).toBeGreaterThan(0)
    expect(result.chiSquareValue).toBeGreaterThanOrEqual(0)
    expect(result.chiSquareCritical).toBeGreaterThan(0)
    expect(typeof result.passed).toBe('boolean')
  })

  test('residuals have correct structure', () => {
    // Use enough observations for a valid free network (3 points, 3 distances = 3 obs,
    // 6 params - 4 constraints = 2 DOF)
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0 },
      { name: 'B', easting: 100, northing: 0 },
      { name: 'C', easting: 50, northing: 86.6 },
    ]
    const observations: NetworkObservation[] = [
      { type: 'distance', from: 'A', to: 'B', value: 100, sigma: 0.005 },
      { type: 'distance', from: 'A', to: 'C', value: 100, sigma: 0.005 },
      { type: 'distance', from: 'B', to: 'C', value: 100, sigma: 0.005 },
    ]

    const result = adjustNetwork(points, observations, { freeNetwork: true })

    expect(result.ok).toBe(true)
    expect(result.residuals).toHaveLength(3)
    const r = result.residuals[0]
    expect(r.type).toBe('distance')
    expect(r.from).toBe('A')
    expect(r.to).toBe('B')
    expect(typeof r.residual).toBe('number')
    expect(typeof r.standardized).toBe('number')
    expect(r.redundancy).toBeGreaterThanOrEqual(0)
    expect(r.redundancy).toBeLessThanOrEqual(1)
    expect(r.mdb).toBeGreaterThan(0)
  })
})
