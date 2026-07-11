import { distanceBearing } from '../distance'

describe('distanceBearing', () => {
  it('calculates distance due north', () => {
    const r = distanceBearing({ easting: 0, northing: 0 }, { easting: 0, northing: 100 })
    expect(r.distance).toBeCloseTo(100, 4)
    expect(r.bearing).toBeCloseTo(0, 4)
  })

  it('calculates bearing due east (90°)', () => {
    const r = distanceBearing({ easting: 0, northing: 0 }, { easting: 100, northing: 0 })
    expect(r.bearing).toBeCloseTo(90, 4)
    expect(r.distance).toBeCloseTo(100, 4)
  })

  it('calculates bearing due south (180°)', () => {
    const r = distanceBearing({ easting: 0, northing: 100 }, { easting: 0, northing: 0 })
    expect(r.bearing).toBeCloseTo(180, 4)
  })

  it('calculates bearing due west (270°)', () => {
    const r = distanceBearing({ easting: 100, northing: 0 }, { easting: 0, northing: 0 })
    expect(r.bearing).toBeCloseTo(270, 4)
  })

  it('back bearing = forward bearing + 180', () => {
    const r = distanceBearing({ easting: 300, northing: 500 }, { easting: 450, northing: 650 })
    expect(Math.abs(r.backBearing - r.bearing)).toBeCloseTo(180, 1)
  })

  it('3-4-5 triangle gives distance 5', () => {
    const r = distanceBearing({ easting: 0, northing: 0 }, { easting: 3, northing: 4 })
    expect(r.distance).toBeCloseTo(5, 6)
  })

  it('deltaE and deltaN are correct', () => {
    const r = distanceBearing({ easting: 1000, northing: 2000 }, { easting: 1300, northing: 2400 })
    expect(r.deltaE).toBeCloseTo(300, 4)
    expect(r.deltaN).toBeCloseTo(400, 4)
    expect(r.distance).toBeCloseTo(500, 1)
  })
})
