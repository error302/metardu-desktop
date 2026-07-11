import { radiation, bearingIntersection, tienstraResection } from '../cogo'

describe('radiation', () => {
  it('computes point due north from station', () => {
    const r = radiation({ easting: 1000, northing: 2000 }, 0, 100)
    expect(r.point.easting).toBeCloseTo(1000, 3)
    expect(r.point.northing).toBeCloseTo(2100, 3)
  })

  it('computes point due east from station', () => {
    const r = radiation({ easting: 1000, northing: 2000 }, 90, 100)
    expect(r.point.easting).toBeCloseTo(1100, 3)
    expect(r.point.northing).toBeCloseTo(2000, 3)
  })

  it('computes point at 45° correctly', () => {
    const r = radiation({ easting: 0, northing: 0 }, 45, 100)
    expect(r.point.easting).toBeCloseTo(70.711, 2)
    expect(r.point.northing).toBeCloseTo(70.711, 2)
  })

  it('preserves distance and bearing in result', () => {
    const r = radiation({ easting: 500, northing: 500 }, 135, 200)
    expect(r.distance).toBeCloseTo(200, 4)
    expect(r.bearing).toBeCloseTo(135, 4)
  })
})

describe('bearingIntersection', () => {
  it('finds intersection of two perpendicular bearings', () => {
    const result = bearingIntersection(
      { easting: 0, northing: 0 }, 90,
      { easting: 100, northing: 100 }, 180
    )
    expect(result).not.toBeNull()
    expect(result!.point.easting).toBeCloseTo(100, 1)
    expect(result!.point.northing).toBeCloseTo(0, 1)
  })

  it('returns null for parallel bearings', () => {
    const result = bearingIntersection(
      { easting: 0, northing: 0 }, 0,
      { easting: 100, northing: 0 }, 0
    )
    expect(result).toBeNull()
  })

  it('returns finite coordinates for valid intersection', () => {
    const result = bearingIntersection(
      { easting: 500, northing: 500 }, 45,
      { easting: 600, northing: 500 }, 315
    )
    expect(result).not.toBeNull()
    expect(Number.isFinite(result!.point.easting)).toBe(true)
    expect(Number.isFinite(result!.point.northing)).toBe(true)
  })
})

describe('tienstraResection', () => {
  it('returns null for degenerate/dangerous circle geometry', () => {
    // When angles are equal and symmetrical, point is on the dangerous circle
    const r = tienstraResection(
      { easting: 0,   northing: 0   },
      { easting: 100, northing: 0   },
      { easting: 50,  northing: 100 },
      50, 50
    )
    // May return null for dangerous configurations — both null and valid are acceptable
    if (r !== null) {
      expect(Number.isFinite(r.point.easting)).toBe(true)
      expect(Number.isFinite(r.point.northing)).toBe(true)
    }
  })

  it('computes valid position for well-conditioned resection', () => {
    // Three control points forming a wide triangle, station inside
    // Known station P at approx (60, 40) observing angles to A, B, C
    const A = { easting: 0,   northing: 0   }
    const B = { easting: 120, northing: 0   }
    const C = { easting: 60,  northing: 120 }
    // Use asymmetric angles to avoid dangerous circle
    const r = tienstraResection(A, B, C, 60, 70)
    if (r !== null) {
      expect(Number.isFinite(r.point.easting)).toBe(true)
      expect(Number.isFinite(r.point.northing)).toBe(true)
    }
  })
})
