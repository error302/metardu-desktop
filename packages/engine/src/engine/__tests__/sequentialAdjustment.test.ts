/**
 * Tests for the sequential adjustment module.
 *
 * Verifies:
 *  - State initialization from a base network
 *  - Adding observations incrementally produces same result as full re-run
 *  - Removing observations works
 *  - Adding/removing points triggers full rebuild
 *  - State serialization round-trips correctly
 *  - Convergence detection works
 */

import {
  initSequentialState,
  addObservations,
  removeObservations,
  addPoint,
  removePoint,
  serializeState,
  deserializeState,
  isConverged,
} from '../sequentialAdjustment'
import { adjustNetwork, type NetworkPoint, type NetworkObservation } from '../networkAdjustment'

function approxEqual(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) < tol
}

describe('sequentialAdjustment — initialization', () => {
  test('initializes state with correct dimensions for 2D', () => {
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, fixed: true },
      { name: 'B', easting: 100, northing: 0, fixed: true },
      { name: 'P', easting: 50, northing: 50 },
    ]
    const observations: NetworkObservation[] = [
      { type: 'distance', from: 'A', to: 'P', value: 70.71, sigma: 0.005 },
      { type: 'distance', from: 'B', to: 'P', value: 70.71, sigma: 0.005 },
    ]

    const state = initSequentialState(points, observations, { dimension: '2D' })

    expect(state.paramPerPoint).toBe(2)
    expect(state.paramCount).toBe(2) // 1 adjustable point × 2
    expect(state.dimension).toBe('2D')
    expect(state.pointIndex.size).toBe(1)
    expect(state.pointIndex.has('P')).toBe(true)
    expect(state.points.length).toBe(3)
    expect(state.observations.length).toBe(2)
  })

  test('initializes state with correct dimensions for 3D', () => {
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, rl: 100, fixed: true },
      { name: 'P', easting: 50, northing: 50, rl: 100 },
    ]
    const observations: NetworkObservation[] = [
      {
        type: 'gnss_baseline', from: 'A', to: 'P', value: 0, sigma: 0.005,
        deltaE: 50, deltaN: 50, deltaU: 0,
        covariance3x3: [0.000025, 0, 0.000025, 0, 0, 0.000025],
      },
    ]

    const state = initSequentialState(points, observations, { dimension: '3D' })

    expect(state.paramPerPoint).toBe(3)
    expect(state.paramCount).toBe(3)
    expect(state.dimension).toBe('3D')
  })
})

describe('sequentialAdjustment — incremental updates', () => {
  test('adding observations matches full re-run', () => {
    // Base network: 2 fixed + 1 unknown, 2 distance observations
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, fixed: true },
      { name: 'B', easting: 100, northing: 0, fixed: true },
      { name: 'C', easting: 50, northing: -100, fixed: true },
      { name: 'P', easting: 50.5, northing: 49.5 },
    ]
    const baseObs: NetworkObservation[] = [
      { type: 'distance', from: 'A', to: 'P', value: 70.71, sigma: 0.005 },
      { type: 'distance', from: 'B', to: 'P', value: 70.71, sigma: 0.005 },
    ]

    const state = initSequentialState(points, baseObs, { convergenceMm: 0.01 })

    // Add a third observation
    const newObs: NetworkObservation[] = [
      { type: 'distance', from: 'C', to: 'P', value: 150, sigma: 0.005 },
    ]

    const updateResult = addObservations(state, newObs)

    // Compare to full re-run
    const fullResult = adjustNetwork(points, [...baseObs, ...newObs], { convergenceMm: 0.01 })

    expect(updateResult.result.ok).toBe(true)
    expect(fullResult.ok).toBe(true)

    const pSequential = updateResult.result.adjustedPoints.find((x) => x.name === 'P')
    const pFull = fullResult.adjustedPoints.find((x) => x.name === 'P')

    expect(pSequential).toBeDefined()
    expect(pFull).toBeDefined()
    expect(approxEqual(pSequential!.easting, pFull!.easting, 0.001)).toBe(true)
    expect(approxEqual(pSequential!.northing, pFull!.northing, 0.001)).toBe(true)
  })

  test('adding multiple observations incrementally', () => {
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, fixed: true },
      { name: 'B', easting: 100, northing: 0, fixed: true },
      { name: 'C', easting: 50, northing: -100, fixed: true },
      { name: 'P', easting: 50.5, northing: 49.5 },
    ]
    const baseObs: NetworkObservation[] = [
      { type: 'distance', from: 'A', to: 'P', value: 70.71, sigma: 0.005 },
    ]

    const state = initSequentialState(points, baseObs, { freeNetwork: false, convergenceMm: 0.01 })

    // Add two more observations one at a time
    addObservations(state, [
      { type: 'distance', from: 'B', to: 'P', value: 70.71, sigma: 0.005 },
    ])
    const final = addObservations(state, [
      { type: 'distance', from: 'C', to: 'P', value: 150, sigma: 0.005 },
    ])

    const fullResult = adjustNetwork(
      points,
      [
        { type: 'distance', from: 'A', to: 'P', value: 70.71, sigma: 0.005 },
        { type: 'distance', from: 'B', to: 'P', value: 70.71, sigma: 0.005 },
        { type: 'distance', from: 'C', to: 'P', value: 150, sigma: 0.005 },
      ],
      { convergenceMm: 0.01 },
    )

    const pSeq = final.result.adjustedPoints.find((x) => x.name === 'P')
    const pFull = fullResult.adjustedPoints.find((x) => x.name === 'P')

    expect(pSeq).toBeDefined()
    expect(pFull).toBeDefined()
    expect(approxEqual(pSeq!.easting, pFull!.easting, 0.001)).toBe(true)
    expect(approxEqual(pSeq!.northing, pFull!.northing, 0.001)).toBe(true)
  })
})

describe('sequentialAdjustment — point management', () => {
  test('addPoint triggers full rebuild', () => {
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, fixed: true },
      { name: 'P', easting: 50, northing: 50 },
    ]
    const observations: NetworkObservation[] = [
      { type: 'distance', from: 'A', to: 'P', value: 70.71, sigma: 0.005 },
    ]

    const state = initSequentialState(points, observations, { freeNetwork: true })
    const newPoint: NetworkPoint = { name: 'Q', easting: 60, northing: 60 }
    const result = addPoint(state, newPoint)

    expect(result.fullRelinearization).toBe(true)
    expect(state.points.length).toBe(3)
    expect(state.points.some((p) => p.name === 'Q')).toBe(true)
  })

  test('addPoint rejects duplicate name', () => {
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, fixed: true },
      { name: 'P', easting: 50, northing: 50 },
    ]
    const observations: NetworkObservation[] = []
    const state = initSequentialState(points, observations, { freeNetwork: true })

    expect(() => addPoint(state, { name: 'A', easting: 99, northing: 99 })).toThrow('already exists')
  })

  test('removePoint also removes observations referencing it', () => {
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, fixed: true },
      { name: 'B', easting: 100, northing: 0, fixed: true },
      { name: 'P', easting: 50, northing: 50 },
    ]
    const observations: NetworkObservation[] = [
      { type: 'distance', from: 'A', to: 'P', value: 70.71, sigma: 0.005 },
      { type: 'distance', from: 'B', to: 'P', value: 70.71, sigma: 0.005 },
    ]
    const state = initSequentialState(points, observations, { freeNetwork: true })

    const result = removePoint(state, 'P')

    expect(state.points.length).toBe(2)
    expect(state.points.some((p) => p.name === 'P')).toBe(false)
    expect(state.observations.length).toBe(0) // both referenced P
  })
})

describe('sequentialAdjustment — serialization', () => {
  test('serialize → deserialize round-trips correctly', () => {
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, fixed: true },
      { name: 'P', easting: 50, northing: 50 },
    ]
    const observations: NetworkObservation[] = [
      { type: 'distance', from: 'A', to: 'P', value: 70.71, sigma: 0.005 },
    ]

    const original = initSequentialState(points, observations, { freeNetwork: true })
    original.totalIterations = 5
    original.lastUpdatedAt = '2026-01-01T00:00:00Z'

    const serialized = serializeState(original)
    const restored = deserializeState(serialized)

    expect(restored.points.length).toBe(original.points.length)
    expect(restored.observations.length).toBe(original.observations.length)
    expect(restored.paramPerPoint).toBe(original.paramPerPoint)
    expect(restored.paramCount).toBe(original.paramCount)
    expect(restored.dimension).toBe(original.dimension)
    expect(restored.totalIterations).toBe(5)
    expect(restored.lastUpdatedAt).toBe('2026-01-01T00:00:00Z')
    expect(restored.pointIndex.size).toBe(original.pointIndex.size)
    expect(restored.currentCoords.size).toBe(original.currentCoords.size)
  })

  test('serialized state is JSON-safe', () => {
    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, fixed: true },
      { name: 'P', easting: 50, northing: 50 },
    ]
    const observations: NetworkObservation[] = [
      { type: 'distance', from: 'A', to: 'P', value: 70.71, sigma: 0.005 },
    ]

    const state = initSequentialState(points, observations)
    const serialized = serializeState(state)

    // Should be JSON-serializable (no Maps, no SparseMatrix objects)
    const json = JSON.stringify(serialized)
    expect(json.length).toBeGreaterThan(0)

    const parsed = JSON.parse(json)
    expect(parsed.points).toBeDefined()
    expect(parsed.N).toBeDefined()
    expect(parsed.N.rowPtr).toBeDefined()
  })
})

describe('sequentialAdjustment — convergence', () => {
  test('isConverged returns true after stable adjustment', () => {
    // Use 2 fixed points and start P at the exact true position
    const trueP = { e: 50, n: 50 }
    const distAP = Math.sqrt(trueP.e ** 2 + trueP.n ** 2)
    const distBP = Math.sqrt((trueP.e - 100) ** 2 + trueP.n ** 2)

    const points: NetworkPoint[] = [
      { name: 'A', easting: 0, northing: 0, fixed: true },
      { name: 'B', easting: 100, northing: 0, fixed: true },
      { name: 'P', easting: trueP.e, northing: trueP.n }, // exact
    ]
    const observations: NetworkObservation[] = [
      { type: 'distance', from: 'A', to: 'P', value: distAP, sigma: 0.005 },
      { type: 'distance', from: 'B', to: 'P', value: distBP, sigma: 0.005 },
    ]

    const state = initSequentialState(points, observations, { convergenceMm: 0.001 })
    addObservations(state, [])

    // With exact initial coords, corrections should be ~0
    expect(isConverged(state, 0.1)).toBe(true)
  })
})
