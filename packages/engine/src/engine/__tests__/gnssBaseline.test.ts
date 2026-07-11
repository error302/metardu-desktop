/**
 * Tests for GNSS baseline vector integration in network adjustment.
 *
 * Verifies:
 *  - Single GNSS baseline between 2 fixed points adjusts correctly
 *  - GNSS baseline with full 3×3 covariance whitens properly
 *  - Mixed GNSS + terrestrial observations converge
 *  - Multiple GNSS baselines form a network
 *  - Whitening produces correct results vs uncorrelated case
 */

import {
  adjustNetwork,
  type NetworkPoint,
  type NetworkObservation,
} from '../networkAdjustment'

function approxEqual(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) < tol
}

describe('networkAdjustment — GNSS baseline integration', () => {
  test('single GNSS baseline between fixed and unknown point in 3D', () => {
    // Fixed point A at (0, 0, 100), unknown point B at approximate (50.1, 49.9, 100.1)
    // True baseline: ΔE=50, ΔN=50, ΔU=0
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, rl: 100, fixed: true },
      { name: 'B', easting: 50.1, northing: 49.9, rl: 100.1 },
    ]
    const observations: NetworkObservation[] = [
      {
        type: 'gnss_baseline',
        from: 'A',
        to: 'B',
        value: 0, // ignored for gnss_baseline
        sigma: 0.005,
        deltaE: 50,
        deltaN: 50,
        deltaU: 0,
        // Diagonal covariance (independent components)
        covariance3x3: [0.000025, 0, 0.000025, 0, 0, 0.000025], // σ²=5mm²
      },
    ]

    const result = adjustNetwork(points, observations, {
      dimension: '3D',
      convergenceMm: 0.01,
    })

    expect(result.ok).toBe(true)
    const b = result.adjustedPoints.find((p) => p.name === 'B')
    expect(b).toBeDefined()
    expect(approxEqual(b!.easting, 50, 0.01)).toBe(true)
    expect(approxEqual(b!.northing, 50, 0.01)).toBe(true)
    expect(approxEqual(b!.rl ?? 0, 100, 0.01)).toBe(true)
  })

  test('GNSS baseline with correlated covariance adjusts correctly', () => {
    // Same setup but with off-diagonal covariance terms
    // The result should still converge to the true position
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, rl: 100, fixed: true },
      { name: 'B', easting: 50.2, northing: 49.8, rl: 99.9 },
    ]
    const observations: NetworkObservation[] = [
      {
        type: 'gnss_baseline',
        from: 'A',
        to: 'B',
        value: 0,
        sigma: 0.005,
        deltaE: 50,
        deltaN: 50,
        deltaU: 0,
        // Correlated covariance: positive correlation between E and N
        covariance3x3: [
          0.000025,  // C_EE
          0.000015,  // C_EN (positive correlation)
          0.000025,  // C_NN
          0,         // C_EU
          0,         // C_NU
          0.000025,  // C_UU
        ],
      },
    ]

    const result = adjustNetwork(points, observations, {
      dimension: '3D',
      convergenceMm: 0.01,
    })

    expect(result.ok).toBe(true)
    const b = result.adjustedPoints.find((p) => p.name === 'B')
    expect(b).toBeDefined()
    expect(approxEqual(b!.easting, 50, 0.01)).toBe(true)
    expect(approxEqual(b!.northing, 50, 0.01)).toBe(true)
    expect(approxEqual(b!.rl ?? 0, 100, 0.01)).toBe(true)
  })

  test('multiple GNSS baselines form a 3D network', () => {
    // Three fixed points, one unknown — triangulation via GNSS
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, rl: 100, fixed: true },
      { name: 'B', easting: 100, northing: 0, rl: 100, fixed: true },
      { name: 'C', easting: 50, northing: 100, rl: 100, fixed: true },
      { name: 'P', easting: 50.5, northing: 49.5, rl: 100.5 },
    ]
    // True position of P: (50, 50, 100)
    const obs_A_P: NetworkObservation = {
      type: 'gnss_baseline',
      from: 'A', to: 'P', value: 0, sigma: 0.005,
      deltaE: 50, deltaN: 50, deltaU: 0,
      covariance3x3: [0.000025, 0, 0.000025, 0, 0, 0.000025],
    }
    const obs_B_P: NetworkObservation = {
      type: 'gnss_baseline',
      from: 'B', to: 'P', value: 0, sigma: 0.005,
      deltaE: -50, deltaN: 50, deltaU: 0,
      covariance3x3: [0.000025, 0, 0.000025, 0, 0, 0.000025],
    }
    const obs_C_P: NetworkObservation = {
      type: 'gnss_baseline',
      from: 'C', to: 'P', value: 0, sigma: 0.005,
      deltaE: 0, deltaN: -50, deltaU: 0,
      covariance3x3: [0.000025, 0, 0.000025, 0, 0, 0.000025],
    }

    const result = adjustNetwork(points, [obs_A_P, obs_B_P, obs_C_P], {
      dimension: '3D',
      convergenceMm: 0.01,
    })

    expect(result.ok).toBe(true)
    const p = result.adjustedPoints.find((x) => x.name === 'P')
    expect(p).toBeDefined()
    expect(approxEqual(p!.easting, 50, 0.01)).toBe(true)
    expect(approxEqual(p!.northing, 50, 0.01)).toBe(true)
    expect(approxEqual(p!.rl ?? 0, 100, 0.01)).toBe(true)
  })

  test('mixed GNSS baseline + terrestrial distance converges', () => {
    // Fixed point A, unknown point B
    // GNSS baseline gives 3D position
    // Terrestrial distance provides additional constraint
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, rl: 100, fixed: true },
      { name: 'B', easting: 60.1, northing: 59.9, rl: 100.1 },
    ]
    const trueDist = Math.sqrt(60 ** 2 + 60 ** 2) // 84.85
    const observations: NetworkObservation[] = [
      {
        type: 'gnss_baseline',
        from: 'A', to: 'B', value: 0, sigma: 0.005,
        deltaE: 60, deltaN: 60, deltaU: 0,
        covariance3x3: [0.000025, 0, 0.000025, 0, 0, 0.000025],
      },
      {
        type: 'distance',
        from: 'A', to: 'B', value: trueDist, sigma: 0.005,
      },
    ]

    const result = adjustNetwork(points, observations, {
      dimension: '3D',
      convergenceMm: 0.01,
    })

    expect(result.ok).toBe(true)
    const b = result.adjustedPoints.find((p) => p.name === 'B')
    expect(b).toBeDefined()
    expect(approxEqual(b!.easting, 60, 0.01)).toBe(true)
    expect(approxEqual(b!.northing, 60, 0.01)).toBe(true)
  })

  test('rejects GNSS baseline in 2D mode', () => {
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, fixed: true },
      { name: 'B', easting: 50, northing: 50 },
    ]
    const observations: NetworkObservation[] = [
      {
        type: 'gnss_baseline',
        from: 'A', to: 'B', value: 0, sigma: 0.005,
        deltaE: 50, deltaN: 50, deltaU: 0,
        covariance3x3: [0.000025, 0, 0.000025, 0, 0, 0.000025],
      },
    ]

    const result = adjustNetwork(points, observations, { dimension: '2D' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('3D')
  })

  test('rejects GNSS baseline without deltaE/deltaN/deltaU', () => {
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, rl: 100, fixed: true },
      { name: 'B', easting: 50, northing: 50, rl: 100 },
    ]
    const observations: NetworkObservation[] = [
      {
        type: 'gnss_baseline',
        from: 'A', to: 'B', value: 0, sigma: 0.005,
        // Missing deltaE/deltaN/deltaU
      },
    ]

    const result = adjustNetwork(points, observations, { dimension: '3D' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('deltaE')
  })

  test('whitening with identity covariance equals unwhitened', () => {
    // With identity covariance (σ²=1 for each component), the whitened
    // observations should equal the raw observations.
    // We verify this by checking that the adjustment result matches
    // what we'd get with diagonal σ²=1.
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, rl: 100, fixed: true },
      { name: 'B', easting: 50.1, northing: 49.9, rl: 100.1 },
    ]
    const observations: NetworkObservation[] = [
      {
        type: 'gnss_baseline',
        from: 'A', to: 'B', value: 0, sigma: 1,
        deltaE: 50, deltaN: 50, deltaU: 0,
        covariance3x3: [1, 0, 1, 0, 0, 1], // identity
      },
    ]

    const result = adjustNetwork(points, observations, {
      dimension: '3D',
      convergenceMm: 0.001,
    })

    expect(result.ok).toBe(true)
    const b = result.adjustedPoints.find((p) => p.name === 'B')
    expect(b).toBeDefined()
    // With identity covariance, the adjustment should pull B exactly to the
    // observed baseline (since there's only 1 observation per parameter).
    expect(approxEqual(b!.easting, 50, 0.001)).toBe(true)
    expect(approxEqual(b!.northing, 50, 0.001)).toBe(true)
    expect(approxEqual(b!.rl ?? 0, 100, 0.001)).toBe(true)
  })
})
