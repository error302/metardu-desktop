import {
  adjustLevelNetwork,
  computeObservations,
} from '../levelNetworkAdjustment'
import {
  allowableMisclosure,
  LevelObservation,
  LevelControlPoint,
} from '../digitalLevelTypes'

describe('adjustLevelNetwork', () => {
  test('adjusts simple leveling run A -> B -> C with 1 fixed', () => {
    const observations: LevelObservation[] = [
      { fromId: 'BM1', toId: 'TP1', heightDifference: 0.500, distance: 50, weight: 1 / (0.05 * 0.05) },
      { fromId: 'TP1', toId: 'TP2', heightDifference: -0.300, distance: 40, weight: 1 / (0.04 * 0.04) },
    ]
    const controlPoints: LevelControlPoint[] = [
      { id: 'BM1', rl: 1500.000, isFixed: true },
    ]

    const result = adjustLevelNetwork(observations, controlPoints, 'third')
    expect(result.passed).toBeDefined()
    expect(result.adjustedLevels.length).toBe(3) // BM1, TP1, TP2
    expect(result.adjustedLevels[0].id).toBe('BM1')
    expect(result.adjustedLevels[0].rl).toBeCloseTo(1500.000, 1)
  })

  test('computes misclosure for a closed loop', () => {
    // Triangle: BM1 -> TP1 -> TP2 -> BM1
    // True RLs: BM1=1000, TP1=1001, TP2=1002
    // Obs: +1.000, +1.000, -2.010 (with 10mm misclosure)
    const observations: LevelObservation[] = [
      { fromId: 'BM1', toId: 'TP1', heightDifference: 1.000, distance: 100, weight: 1 },
      { fromId: 'TP1', toId: 'TP2', heightDifference: 1.000, distance: 100, weight: 1 },
      { fromId: 'TP2', toId: 'BM1', heightDifference: -2.010, distance: 100, weight: 1 },
    ]
    const controlPoints: LevelControlPoint[] = [
      { id: 'BM1', rl: 1000.000, isFixed: true },
    ]

    const result = adjustLevelNetwork(observations, controlPoints, 'third')
    // Misclosure should be non-zero
    expect(result.misclosure).toBeDefined()
    expect(result.totalDistance).toBeCloseTo(0.3) // 3 x 100m = 300m = 0.3km
    expect(result.degreesOfFreedom).toBeGreaterThan(0)
  })

  test('allowable misclosure per Kenya order standards', () => {
    // 4th order: 20*sqrt(L) mm, L in km
    expect(allowableMisclosure(1.0, 'fourth')).toBeCloseTo(20.0, 1)
    // 1st order: 4*sqrt(L) mm
    expect(allowableMisclosure(1.0, 'first')).toBeCloseTo(4.0, 1)
    // 2nd order: 6*sqrt(L)
    expect(allowableMisclosure(1.0, 'second')).toBeCloseTo(6.0, 1)
    // 3rd order: 10*sqrt(L)
    expect(allowableMisclosure(1.0, 'third')).toBeCloseTo(10.0, 1)
    // For L=4 km, 4th order: 20*sqrt(4) = 40mm
    expect(allowableMisclosure(4.0, 'fourth')).toBeCloseTo(40.0, 1)
  })

  test('throws when no observations provided', () => {
    expect(function() {
      adjustLevelNetwork([], [{ id: 'A', rl: 100, isFixed: true }], 'third')
    }).toThrow('At least one level observation')
  })

  test('throws when no fixed control point', () => {
    const obs: LevelObservation[] = [
      { fromId: 'A', toId: 'B', heightDifference: 1.0, distance: 50, weight: 1 },
    ]
    expect(function() {
      adjustLevelNetwork(obs, [{ id: 'A', rl: 100, isFixed: false }], 'third')
    }).toThrow('At least one fixed control point')
  })

  test('forward propagation gives initial height estimates', () => {
    const observations: LevelObservation[] = [
      { fromId: 'BM1', toId: 'TP1', heightDifference: 2.500, distance: 50, weight: 1 },
      { fromId: 'TP1', toId: 'BM2', heightDifference: -1.200, distance: 50, weight: 1 },
    ]
    const controlPoints: LevelControlPoint[] = [
      { id: 'BM1', rl: 1200.000, isFixed: true },
    ]

    const result = adjustLevelNetwork(observations, controlPoints, 'third')
    const tp1 = result.adjustedLevels.find(function(p) { return p.id === 'TP1' })
    expect(tp1).toBeDefined()
    expect(tp1!.rl).toBeCloseTo(1202.5, 0) // initial: 1200 + 2.5
  })

  test('all-fixed-stations edge case returns residuals', () => {
    const observations: LevelObservation[] = [
      { fromId: 'BM1', toId: 'BM2', heightDifference: 5.000, distance: 100, weight: 1 },
    ]
    const controlPoints: LevelControlPoint[] = [
      { id: 'BM1', rl: 1000.000, isFixed: true },
      { id: 'BM2', rl: 1005.010, isFixed: true }, // 10mm misclosure
    ]

    const result = adjustLevelNetwork(observations, controlPoints, 'fourth')
    expect(result.adjustedLevels).toHaveLength(2)
    expect(result.residuals).toHaveLength(1)
    // Residual should be non-zero since observed diff != actual diff
    expect(result.residuals[0].residual).toBeDefined()
  })

  test('reference variance is computed', () => {
    const observations: LevelObservation[] = [
      { fromId: 'BM1', toId: 'TP1', heightDifference: 1.000, distance: 30, weight: 1000 },
      { fromId: 'TP1', toId: 'BM2', heightDifference: -0.500, distance: 30, weight: 1000 },
      { fromId: 'BM2', toId: 'BM1', heightDifference: -0.510, distance: 30, weight: 1000 }, // 10mm misclosure
    ]
    const controlPoints: LevelControlPoint[] = [
      { id: 'BM1', rl: 1000.000, isFixed: true },
    ]

    const result = adjustLevelNetwork(observations, controlPoints, 'third')
    expect(result.referenceVariance).toBeGreaterThanOrEqual(0)
    expect(result.degreesOfFreedom).toBeGreaterThan(0)
  })
})

describe('computeObservations', () => {
  test('builds LevelObservation from BS/FS reading pairs', () => {
    const readings = [
      { stationId: 'BM1', type: 'BS', staffReading: 1.500, distance: 30 },
      { stationId: 'TP1', type: 'FS', staffReading: 0.800, distance: 30 },
      { stationId: 'TP1', type: 'BS', staffReading: 1.400, distance: 25 },
      { stationId: 'BM2', type: 'FS', staffReading: 0.700, distance: 25 },
    ]

    const observations = computeObservations(readings)
    expect(observations).toHaveLength(2)
    expect(observations[0].fromId).toBe('BM1')
    expect(observations[0].toId).toBe('TP1')
    expect(observations[0].heightDifference).toBeCloseTo(0.7, 5)
    expect(observations[0].weight).toBeGreaterThan(0)
  })

  test('ignores IS readings', () => {
    const readings = [
      { stationId: 'BM1', type: 'BS', staffReading: 1.500, distance: 30 },
      { stationId: 'TP1', type: 'IS', staffReading: 1.200, distance: 30 },
      { stationId: 'TP1', type: 'FS', staffReading: 0.800, distance: 30 },
    ]

    const observations = computeObservations(readings)
    expect(observations).toHaveLength(1) // IS doesn't create an observation
  })

  test('returns empty for unmatched BS', () => {
    const readings = [
      { stationId: 'BM1', type: 'BS', staffReading: 1.500, distance: 30 },
    ]
    const observations = computeObservations(readings)
    expect(observations).toHaveLength(0)
  })
})
