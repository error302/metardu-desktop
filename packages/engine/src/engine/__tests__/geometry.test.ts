import { midpoint, pointInPolygon, lineIntersection, angularMisclosureFromAngles } from '../geometry'

describe('midpoint', () => {
  it('midpoint of two points on x-axis', () => {
    const m = midpoint({ easting: 0, northing: 0 }, { easting: 10, northing: 0 })
    expect(m.easting).toBeCloseTo(5, 6)
    expect(m.northing).toBeCloseTo(0, 6)
  })

  it('midpoint of diagonal points', () => {
    const m = midpoint({ easting: 0, northing: 0 }, { easting: 10, northing: 10 })
    expect(m.easting).toBeCloseTo(5, 6)
    expect(m.northing).toBeCloseTo(5, 6)
  })
})

describe('pointInPolygon', () => {
  const SQUARE = [
    { easting: 0, northing: 0 },
    { easting: 10, northing: 0 },
    { easting: 10, northing: 10 },
    { easting: 0, northing: 10 },
  ]

  it('centre point is inside the polygon', () => {
    expect(pointInPolygon({ easting: 5, northing: 5 }, SQUARE)).toBe(true)
  })

  it('point outside the polygon', () => {
    expect(pointInPolygon({ easting: 20, northing: 20 }, SQUARE)).toBe(false)
  })

  it('far outside point is not inside', () => {
    expect(pointInPolygon({ easting: -100, northing: -100 }, SQUARE)).toBe(false)
  })
})

describe('lineIntersection', () => {
  it('perpendicular lines intersect at origin', () => {
    const r = lineIntersection(
      { easting: -10, northing: 0 }, { easting: 10, northing: 0 },
      { easting: 0, northing: -10 }, { easting: 0, northing: 10 }
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.point.easting).toBeCloseTo(0, 4)
      expect(r.value.point.northing).toBeCloseTo(0, 4)
    }
  })

  it('parallel lines return error', () => {
    const r = lineIntersection(
      { easting: 0, northing: 0 }, { easting: 10, northing: 0 },
      { easting: 0, northing: 5 }, { easting: 10, northing: 5 }
    )
    expect(r.ok).toBe(false)
  })
})

describe('angularMisclosureFromAngles', () => {
  it('zero misclosure for perfect 4-station traverse angles', () => {
    // 4-station: sum of interior angles = (4-2)×180 = 360°
    const r = angularMisclosureFromAngles([90, 90, 90, 90])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.misclosure * 60).toBeCloseTo(0, 4)
    }
  })

  it('detects non-zero misclosure', () => {
    // Sum = 361° instead of 360°
    const r = angularMisclosureFromAngles([91, 90, 90, 90])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(Math.abs(r.value.misclosure * 60)).toBeGreaterThan(0)
    }
  })
})
