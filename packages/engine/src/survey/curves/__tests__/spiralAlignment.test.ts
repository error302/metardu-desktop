/**
 * Tests for spiralAlignment.ts
 *
 * Verifies:
 *   - TS/SC/CS/ST chainage computation
 *   - Tangent length T = k + (R+p)·tan(Δ/2)
 *   - Circular curve length Lc = R·(Δ - 2θs)
 *   - Total length = 2·Ls + Lc
 *   - Station interpolation at TS, SC, CS, ST
 *   - Coordinate array shape for OpenLayers
 *   - CSV export
 *   - Error handling (zero Δ, spirals too long, etc.)
 */

import {
  computeSpiralAlignment,
  stationSpiralAlignment,
  stationAtDistance,
  alignmentToCoordinateArray,
  spiralAlignmentToCSV,
  type SpiralAlignmentInput,
} from '../spiralAlignment'

const SAMPLE_INPUT: SpiralAlignmentInput = {
  radius: 300,
  intersectionAngleDeg: 30,
  spiralLength: 60,
  piChainage: 1000,
}

describe('computeSpiralAlignment — chainages', () => {
  it('computes TS < SC < CS < ST in order', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    expect(a.tsChainage).toBeLessThan(a.scChainage)
    expect(a.scChainage).toBeLessThan(a.csChainage)
    expect(a.csChainage).toBeLessThan(a.stChainage)
  })

  it('places SC exactly Ls after TS', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    expect(a.scChainage - a.tsChainage).toBeCloseTo(SAMPLE_INPUT.spiralLength, 2)
  })

  it('places ST exactly Ls after CS', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    expect(a.stChainage - a.csChainage).toBeCloseTo(SAMPLE_INPUT.spiralLength, 2)
  })

  it('places CS exactly Lc after SC', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    expect(a.csChainage - a.scChainage).toBeCloseTo(a.Lc, 2)
  })

  it('totalLength = 2·Ls + Lc', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    expect(a.totalLength).toBeCloseTo(2 * SAMPLE_INPUT.spiralLength + a.Lc, 2)
  })

  it('stChainage - tsChainage = totalLength', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    expect(a.stChainage - a.tsChainage).toBeCloseTo(a.totalLength, 2)
  })
})

describe('computeSpiralAlignment — geometry', () => {
  it('T = k + (R + p)·tan(Δ/2)', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    const expectedT = a.k + (SAMPLE_INPUT.radius + a.p) * Math.tan(a.deltaRad / 2)
    expect(a.T).toBeCloseTo(expectedT, 2)
  })

  it('Lc = R·(Δ - 2θs)', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    const expectedLc = SAMPLE_INPUT.radius * (a.deltaRad - 2 * a.thetaSRad)
    expect(a.Lc).toBeCloseTo(expectedLc, 2)
  })

  it('θs = Ls / (2R)', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    const expectedTheta = SAMPLE_INPUT.spiralLength / (2 * SAMPLE_INPUT.radius)
    expect(a.thetaSRad).toBeCloseTo(expectedTheta, 6)
  })

  it('produces positive T, Lc, totalLength', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    expect(a.T).toBeGreaterThan(0)
    expect(a.Lc).toBeGreaterThan(0)
    expect(a.totalLength).toBeGreaterThan(0)
  })

  it('reports world coordinates when PI coords are supplied', () => {
    const a = computeSpiralAlignment({
      ...SAMPLE_INPUT,
      piEasting: 5000,
      piNorthing: 6000,
      approachBearingDeg: 90, // East
    })
    expect(a.tsCoord).not.toBeNull()
    expect(a.scCoord).not.toBeNull()
    expect(a.csCoord).not.toBeNull()
    expect(a.stCoord).not.toBeNull()
    // TS is behind PI along approach tangent
    // Approach bearing 90° = East, so TS is WEST of PI
    expect(a.tsCoord!.easting).toBeLessThan(5000)
    expect(a.tsCoord!.northing).toBeCloseTo(6000, 1)
  })

  it('returns null coords when PI coords are not supplied', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    expect(a.tsCoord).toBeNull()
    expect(a.scCoord).toBeNull()
    expect(a.csCoord).toBeNull()
    expect(a.stCoord).toBeNull()
    expect(a.piCoord).toBeNull()
  })
})

describe('computeSpiralAlignment — error handling', () => {
  it('throws on non-positive radius', () => {
    expect(() =>
      computeSpiralAlignment({ ...SAMPLE_INPUT, radius: 0 })
    ).toThrow(/Radius must be positive/)
    expect(() =>
      computeSpiralAlignment({ ...SAMPLE_INPUT, radius: -10 })
    ).toThrow(/Radius must be positive/)
  })

  it('throws on negative spiral length', () => {
    expect(() =>
      computeSpiralAlignment({ ...SAMPLE_INPUT, spiralLength: -1 })
    ).toThrow(/Spiral length/)
  })

  it('throws on zero intersection angle', () => {
    expect(() =>
      computeSpiralAlignment({ ...SAMPLE_INPUT, intersectionAngleDeg: 0 })
    ).toThrow(/Intersection angle must be non-zero/)
  })

  it('throws when spirals are too long for the intersection angle', () => {
    // θs = Ls/(2R) = 100/(2·50) = 1 rad = 57.3°
    // 2θs = 114.6° > Δ = 30°
    expect(() =>
      computeSpiralAlignment({
        ...SAMPLE_INPUT,
        radius: 50,
        spiralLength: 100,
      })
    ).toThrow(/no room for circular curve/)
  })
})

describe('stationSpiralAlignment', () => {
  it('samples stations at the requested interval', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    const stations = stationSpiralAlignment(a, 20)
    expect(stations.length).toBeGreaterThan(5)
    expect(stations[0].chainage).toBeCloseTo(a.tsChainage, 1)
    expect(stations[stations.length - 1].chainage).toBeCloseTo(a.stChainage, 1)
  })

  it('labels each station with its segment', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    const stations = stationSpiralAlignment(a, 5)
    const segments = new Set(stations.map(s => s.segment))
    expect(segments.has('entry-spiral')).toBe(true)
    expect(segments.has('circular')).toBe(true)
    expect(segments.has('exit-spiral')).toBe(true)
  })

  it('places the first station at TS with zero distance', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    const stations = stationSpiralAlignment(a, 20)
    expect(stations[0].distanceFromTS).toBe(0)
    expect(stations[0].chainage).toBeCloseTo(a.tsChainage, 1)
  })

  it('places the last station at ST', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    const stations = stationSpiralAlignment(a, 20)
    expect(stations[stations.length - 1].distanceFromTS).toBeCloseTo(a.totalLength, 0)
  })
})

describe('stationAtDistance', () => {
  it('returns null for negative distance', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    expect(stationAtDistance(a, -10)).toBeNull()
  })

  it('returns null for distance beyond totalLength', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    expect(stationAtDistance(a, a.totalLength + 10)).toBeNull()
  })

  it('returns a station at distance 0 with segment "entry-spiral"', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    const s = stationAtDistance(a, 0)
    expect(s).not.toBeNull()
    expect(s!.segment).toBe('entry-spiral')
    expect(s!.distanceFromTS).toBe(0)
    expect(s!.offset).toBe(0) // at TS, offset is 0
  })

  it('returns a station at Ls with segment "circular" (SC point)', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    const s = stationAtDistance(a, SAMPLE_INPUT.spiralLength + 0.001)
    expect(s).not.toBeNull()
    expect(s!.segment).toBe('circular')
  })

  it('returns a station at totalLength with segment "exit-spiral" (ST point)', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    const s = stationAtDistance(a, a.totalLength)
    expect(s).not.toBeNull()
    expect(s!.segment).toBe('exit-spiral')
  })

  it('monotonically increases deflection angle along the alignment', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    const stations = stationSpiralAlignment(a, 10)
    for (let i = 1; i < stations.length; i++) {
      // Allow equal values at segment boundaries (rounding)
      expect(stations[i].deflectionDeg).toBeGreaterThanOrEqual(
        stations[i - 1].deflectionDeg - 0.1
      )
    }
  })
})

describe('alignmentToCoordinateArray', () => {
  it('returns an array of [easting, northing] pairs', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    const coords = alignmentToCoordinateArray(a, 10)
    expect(coords.length).toBeGreaterThan(5)
    for (const c of coords) {
      expect(Array.isArray(c)).toBe(true)
      expect(c.length).toBe(2)
      expect(typeof c[0]).toBe('number')
      expect(typeof c[1]).toBe('number')
    }
  })

  it('uses world coordinates when PI coords are supplied', () => {
    const a = computeSpiralAlignment({
      ...SAMPLE_INPUT,
      piEasting: 1000,
      piNorthing: 2000,
    })
    const coords = alignmentToCoordinateArray(a, 20)
    // First coord should be the TS in world coords
    expect(coords[0][0]).not.toBe(0)
    expect(coords[0][1]).not.toBe(0)
  })
})

describe('spiralAlignmentToCSV', () => {
  it('produces a CSV with header and one row per station', () => {
    const a = computeSpiralAlignment(SAMPLE_INPUT)
    const stations = stationSpiralAlignment(a, 20)
    const csv = spiralAlignmentToCSV(stations)
    const lines = csv.split('\n')
    expect(lines[0]).toContain('Chainage_m')
    expect(lines[0]).toContain('Deflection_deg')
    expect(lines.length).toBe(stations.length + 1)
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].split(',').length).toBe(7)
    }
  })
})
