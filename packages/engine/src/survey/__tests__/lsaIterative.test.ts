/**
 * Tests for the Iterative LSA (non-linear least squares) module
 */

import {
  adjustNetworkIterative,
  type NetworkStation,
  type GenericObservation,
} from '../lsaIterative'

describe('adjustNetworkIterative', () => {
  const fixedStation: NetworkStation = {
    id: 'stn-1',
    name: 'A',
    easting: 500000,
    northing: 9900000,
    elevation: 1500,
    isFixed: true,
  }

  const freeStation: NetworkStation = {
    id: 'stn-2',
    name: 'B',
    easting: 500100,  // ~100m east + 100m north of fixed
    northing: 9900100,
    elevation: 1510,
    isFixed: false,
  }

  test('converges for coordinate difference observations', () => {
    const obs: GenericObservation = {
      type: 'coordinate_diff',
      from: 'stn-1',
      to: 'stn-2',
      deltaE: 100,
      deltaN: 100,
      deltaH: 10,
      stdDevE: 0.005,
      stdDevN: 0.005,
      stdDevH: 0.010,
    }
    const result = adjustNetworkIterative([fixedStation, freeStation], [obs])

    expect(result.converged).toBe(true)
    expect(result.iterations).toBeLessThanOrEqual(5)
    expect(result.finalCorrection).toBeLessThan(1e-6)
    expect(result.adjustedStations).toHaveLength(2)

    // Free station should be at the observed position
    const free = result.adjustedStations.find(s => s.id === 'stn-2')!
    expect(free.easting).toBeCloseTo(500100, 4)
    expect(free.northing).toBeCloseTo(9900100, 4)
    expect(free.elevation).toBeCloseTo(1510, 4)
  })

  test('handles slope distance observations', () => {
    // Free station is 100m east, 100m north, 10m up from fixed
    // Distance = sqrt(100² + 100² + 10²) = ~141.42m
    const free2: NetworkStation = {
      id: 'stn-2',
      name: 'B',
      easting: 500100,
      northing: 9900100,
      elevation: 1510,
      isFixed: false,
    }

    const obs: GenericObservation = {
      type: 'slope_distance',
      from: 'stn-1',
      to: 'stn-2',
      distance: Math.sqrt(100 * 100 + 100 * 100 + 10 * 10),
      stdDevDistance: 0.003,
    }

    // Add a coordinate diff as well to constrain the position
    const obs2: GenericObservation = {
      type: 'coordinate_diff',
      from: 'stn-1',
      to: 'stn-2',
      deltaE: 100,
      deltaN: 100,
      deltaH: 10,
      stdDevE: 0.005,
      stdDevN: 0.005,
      stdDevH: 0.010,
    }

    const result = adjustNetworkIterative([fixedStation, free2], [obs, obs2])

    expect(result.converged).toBe(true)
    const free = result.adjustedStations.find(s => s.id === 'stn-2')!
    expect(free.easting).toBeCloseTo(500100, 2)
    expect(free.northing).toBeCloseTo(9900100, 2)
  })

  test('computes statistical report when dof > 0', () => {
    // Two observations of the same baseline → redundancy
    const obs1: GenericObservation = {
      type: 'coordinate_diff',
      from: 'stn-1',
      to: 'stn-2',
      deltaE: 100.000,
      deltaN: 100.000,
      deltaH: 10.000,
      stdDevE: 0.005,
      stdDevN: 0.005,
      stdDevH: 0.010,
    }
    const obs2: GenericObservation = {
      type: 'coordinate_diff',
      from: 'stn-1',
      to: 'stn-2',
      deltaE: 100.005,  // 5mm discrepancy
      deltaN: 99.998,
      deltaH: 10.002,
      stdDevE: 0.005,
      stdDevN: 0.005,
      stdDevH: 0.010,
    }

    const result = adjustNetworkIterative([fixedStation, freeStation], [obs1, obs2])

    expect(result.degreesOfFreedom).toBeGreaterThan(0)
    expect(result.statisticalReport).toBeDefined()
    expect(result.statisticalReport!.globalTest).toBeDefined()
    expect(result.statisticalReport!.reliability).toBeDefined()
  })

  test('computes residual diagnostics when enabled', () => {
    const obs1: GenericObservation = {
      type: 'coordinate_diff',
      from: 'stn-1',
      to: 'stn-2',
      deltaE: 100.000,
      deltaN: 100.000,
      deltaH: 10.000,
      stdDevE: 0.005,
      stdDevN: 0.005,
      stdDevH: 0.010,
    }
    const obs2: GenericObservation = {
      type: 'coordinate_diff',
      from: 'stn-1',
      to: 'stn-2',
      deltaE: 100.005,
      deltaN: 99.998,
      deltaH: 10.002,
      stdDevE: 0.005,
      stdDevN: 0.005,
      stdDevH: 0.010,
    }

    const result = adjustNetworkIterative([fixedStation, freeStation], [obs1, obs2], {
      includeDiagnostics: true,
    })

    expect(result.diagnostics).toBeDefined()
    expect(result.diagnostics!.kolmogorovSmirnov).toBeDefined()
    expect(result.diagnostics!.andersonDarling).toBeDefined()
  })

  test('throws when no fixed stations', () => {
    const obs: GenericObservation = {
      type: 'coordinate_diff',
      from: 'stn-1',
      to: 'stn-2',
      deltaE: 100,
      deltaN: 100,
      deltaH: 10,
    }
    expect(() => adjustNetworkIterative([freeStation], [obs])).toThrow(
      'At least one fixed control station is required',
    )
  })

  test('throws when no observations', () => {
    expect(() => adjustNetworkIterative([fixedStation, freeStation], [])).toThrow(
      'At least one observation is required',
    )
  })

  test('warns when only 1 fixed station (swinging traverse)', () => {
    const obs: GenericObservation = {
      type: 'coordinate_diff',
      from: 'stn-1',
      to: 'stn-2',
      deltaE: 100,
      deltaN: 100,
      deltaH: 10,
    }
    const result = adjustNetworkIterative([fixedStation, freeStation], [obs])
    expect(result.warnings.some(w => w.includes('swinging traverse'))).toBe(true)
  })

  test('handles horizontal direction observations', () => {
    // Direction from stn-1 to stn-2: atan2(100, 100) = π/4 = 45°
    const obs: GenericObservation = {
      type: 'horizontal_direction',
      from: 'stn-1',
      to: 'stn-2',
      direction: Math.PI / 4,  // 45° from North
      stdDevDirection: 5e-6,   // ~1 arcsecond
    }
    // Add coordinate diffs to constrain position
    const obs2: GenericObservation = {
      type: 'coordinate_diff',
      from: 'stn-1',
      to: 'stn-2',
      deltaE: 100,
      deltaN: 100,
      deltaH: 10,
    }
    const result = adjustNetworkIterative([fixedStation, freeStation], [obs, obs2])
    expect(result.converged).toBe(true)
  })

  test('produces error ellipses for free stations', () => {
    const obs1: GenericObservation = {
      type: 'coordinate_diff',
      from: 'stn-1',
      to: 'stn-2',
      deltaE: 100,
      deltaN: 100,
      deltaH: 10,
    }
    const obs2: GenericObservation = {
      type: 'coordinate_diff',
      from: 'stn-1',
      to: 'stn-2',
      deltaE: 100.005,
      deltaN: 99.998,
      deltaH: 10.002,
    }
    const result = adjustNetworkIterative([fixedStation, freeStation], [obs1, obs2])

    const free = result.adjustedStations.find(s => s.id === 'stn-2')!
    expect(free.semiMajor).toBeGreaterThanOrEqual(0)
    expect(free.semiMinor).toBeGreaterThanOrEqual(0)
    expect(free.orientation).toBeGreaterThanOrEqual(0)
    expect(free.sigmaE).toBeGreaterThanOrEqual(0)
    expect(free.sigmaN).toBeGreaterThanOrEqual(0)
  })
})
