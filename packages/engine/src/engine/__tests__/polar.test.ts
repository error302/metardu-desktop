import { polar2D, polar3D } from '../polar'

describe('polar2D', () => {
  it('bearing 0° (north) moves point northward', () => {
    const r = polar2D({ station: { easting: 500, northing: 500 }, bearing: 0, horizontalDistance: 100 })
    expect(r.easting).toBeCloseTo(500, 3)
    expect(r.northing).toBeCloseTo(600, 3)
  })

  it('bearing 90° (east) moves point eastward', () => {
    const r = polar2D({ station: { easting: 500, northing: 500 }, bearing: 90, horizontalDistance: 100 })
    expect(r.easting).toBeCloseTo(600, 3)
    expect(r.northing).toBeCloseTo(500, 3)
  })

  it('bearing 180° (south) moves point southward', () => {
    const r = polar2D({ station: { easting: 500, northing: 500 }, bearing: 180, horizontalDistance: 100 })
    expect(r.easting).toBeCloseTo(500, 3)
    expect(r.northing).toBeCloseTo(400, 3)
  })

  it('45° bearing gives equal easting and northing increment', () => {
    const r = polar2D({ station: { easting: 0, northing: 0 }, bearing: 45, horizontalDistance: 100 })
    expect(Math.abs(r.easting - r.northing)).toBeLessThan(0.001)
  })
})

describe('polar3D', () => {
  it('level sight (0° vertical) gives same result as polar2D', () => {
    const station = { easting: 100, northing: 200, elevation: 50 }
    const p2 = polar2D({ station, bearing: 60, horizontalDistance: 80 })
    const p3 = polar3D({ station, bearing: 60, slopeDistance: 80, verticalAngle: 0 })
    expect(p3.easting).toBeCloseTo(p2.easting, 2)
    expect(p3.northing).toBeCloseTo(p2.northing, 2)
  })

  it('positive vertical angle raises elevation', () => {
    const station = { easting: 0, northing: 0, elevation: 100 }
    const r = polar3D({ station, bearing: 0, slopeDistance: 100, verticalAngle: 30 })
    expect(r.elevation).toBeGreaterThan(100)
  })

  it('negative vertical angle lowers elevation', () => {
    const station = { easting: 0, northing: 0, elevation: 100 }
    const r = polar3D({ station, bearing: 0, slopeDistance: 100, verticalAngle: -30 })
    expect(r.elevation).toBeLessThan(100)
  })
})
