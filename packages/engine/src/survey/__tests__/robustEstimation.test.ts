/**
 * Tests for Robust Estimation (IRLS with Huber/IGG3/Tukey)
 */

import {
  computeRobustWeight,
  adjustNetworkRobust,
  type WeightFunction,
} from '../robustEstimation'
import type { NetworkStation, GenericObservation } from '../lsaIterative'

describe('computeRobustWeight', () => {
  test.each(['huber', 'igg3', 'tukey'] as WeightFunction[])(
    '%s returns weight 1 for u=0 (no error)',
    (fn) => {
      const w = computeRobustWeight(0, fn)
      expect(w).toBeCloseTo(1, 6)
    },
  )

  test.each(['huber', 'igg3', 'tukey'] as WeightFunction[])(
    '%s returns weight < 1 for large |u|',
    (fn) => {
      const w = computeRobustWeight(5, fn)  // 5σ outlier
      expect(w).toBeLessThan(1)
    },
  )

  it('Huber: weight = 1 inside the threshold', () => {
    const w = computeRobustWeight(1.0, 'huber', { huberC: 1.345 })
    expect(w).toBe(1)
  })

  it('Huber: weight = c/|u| outside the threshold', () => {
    const w = computeRobustWeight(2.69, 'huber', { huberC: 1.345 })
    expect(w).toBeCloseTo(1.345 / 2.69, 4)
  })

  it('IGG3: weight = 0 for |u| > k1 (hard rejection)', () => {
    const w = computeRobustWeight(3.0, 'igg3', { igg3K0: 1.5, igg3K1: 2.5 })
    expect(w).toBe(0)
  })

  it('IGG3: weight = 1 for |u| ≤ k0', () => {
    const w = computeRobustWeight(1.0, 'igg3', { igg3K0: 1.5, igg3K1: 2.5 })
    expect(w).toBe(1)
  })

  it('Tukey: weight = 0 for |u| > c (hard rejection)', () => {
    const w = computeRobustWeight(5.0, 'tukey', { tukeyC: 4.685 })
    expect(w).toBe(0)
  })

  it('Tukey: smoothly down-weights between 0 and c', () => {
    const w = computeRobustWeight(2.0, 'tukey', { tukeyC: 4.685 })
    expect(w).toBeGreaterThan(0)
    expect(w).toBeLessThan(1)
  })
})

describe('adjustNetworkRobust', () => {
  const fixedStation: NetworkStation = {
    id: 'stn-1', name: 'A',
    easting: 500000, northing: 9900000, elevation: 1500,
    isFixed: true,
  }
  const freeStation: NetworkStation = {
    id: 'stn-2', name: 'B',
    easting: 500100, northing: 9900100, elevation: 1510,
    isFixed: false,
  }

  function makeGoodObs(deltaE: number, deltaN: number, deltaH: number): GenericObservation {
    return {
      type: 'coordinate_diff',
      from: 'stn-1', to: 'stn-2',
      deltaE, deltaN, deltaH,
      stdDevE: 0.005, stdDevN: 0.005, stdDevH: 0.010,
    }
  }

  test('produces clean results when no blunders present', () => {
    const observations = [
      makeGoodObs(100, 100, 10),
      makeGoodObs(100.005, 99.998, 10.002),
    ]
    const result = adjustNetworkRobust([fixedStation, freeStation], observations, {
      weightFunction: 'huber',
    })

    expect(result.converged).toBe(true)
    expect(result.blunders).toHaveLength(0)
    expect(result.method).toBe('huber')
  })

  test('detects and down-weights blunders', () => {
    // Add a blunder observation with a 0.5m error (100× the stdDev of 5mm).
    // With 3 good observations and 1 blunder, IRLS should down-weight the blunder.
    const observations = [
      makeGoodObs(100, 100, 10),
      makeGoodObs(100.005, 99.998, 10.002),
      makeGoodObs(100.002, 100.001, 9.999),
      makeGoodObs(100.5, 100, 10),     // BLUNDER: 0.5m error in E
    ]
    const result = adjustNetworkRobust([fixedStation, freeStation], observations, {
      weightFunction: 'tukey',  // most aggressive
      maxIterations: 30,
    })

    expect(result.converged).toBe(true)
    // At least one observation should be down-weighted (weight < 0.9)
    const downWeighted = result.finalWeights.filter(w => w < 0.9)
    expect(downWeighted.length).toBeGreaterThan(0)
  })

  test('all three weight functions can be used', () => {
    const observations = [
      makeGoodObs(100, 100, 10),
      makeGoodObs(100.005, 99.998, 10.002),
    ]

    for (const fn of ['huber', 'igg3', 'tukey'] as WeightFunction[]) {
      const result = adjustNetworkRobust([fixedStation, freeStation], observations, {
        weightFunction: fn,
      })
      expect(result.method).toBe(fn)
      expect(result.converged).toBe(true)
    }
  })

  test('includes summary string', () => {
    const observations = [
      makeGoodObs(100, 100, 10),
      makeGoodObs(100.005, 99.998, 10.002),
    ]
    const result = adjustNetworkRobust([fixedStation, freeStation], observations)
    expect(result.summary).toContain('HUBER')
    expect(result.summary).toContain('converged')
    expect(result.summary).toContain('σ₀')
  })

  test('produces adjusted stations with error ellipses', () => {
    const observations = [
      makeGoodObs(100, 100, 10),
      makeGoodObs(100.005, 99.998, 10.002),
    ]
    const result = adjustNetworkRobust([fixedStation, freeStation], observations)
    const free = result.adjustedStations.find(s => s.id === 'stn-2')!
    expect(free.semiMajor).toBeGreaterThanOrEqual(0)
    expect(free.sigmaE).toBeGreaterThanOrEqual(0)
  })
})
