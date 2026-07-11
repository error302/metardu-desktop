import { slopeDistance, horizontalDistance, verticalDistance, gradient, polarPoint } from '../distance'

describe('slopeDistance', () => {
  it('returns horizontal distance for 0° vertical angle', () => {
    expect(slopeDistance(100, 0)).toBeCloseTo(100, 4)
  })

  it('slope distance is longer than horizontal for elevated angle', () => {
    expect(slopeDistance(100, 30)).toBeGreaterThan(100)
  })
})

describe('horizontalDistance', () => {
  it('level slope gives same horizontal distance', () => {
    expect(horizontalDistance(100, 0)).toBeCloseTo(100, 4)
  })

  it('inverse of slopeDistance', () => {
    const sd = slopeDistance(80, 20)
    expect(horizontalDistance(sd, 20)).toBeCloseTo(80, 3)
  })
})

describe('verticalDistance', () => {
  it('returns zero for 0° angle', () => {
    expect(verticalDistance(100, 0)).toBeCloseTo(0, 6)
  })

  it('returns slope distance for 90° angle', () => {
    expect(verticalDistance(100, 90)).toBeCloseTo(100, 3)
  })

  it('positive for elevated angles', () => {
    expect(verticalDistance(100, 30)).toBeGreaterThan(0)
  })
})

describe('gradient', () => {
  it('5m rise over 100m gives 5%', () => {
    expect(gradient(5, 100).percentage).toBeCloseTo(5, 4)
  })

  it('negative rise gives negative gradient', () => {
    expect(gradient(-10, 100).percentage).toBeCloseTo(-10, 4)
  })

  it('degrees and percentage are consistent', () => {
    const g = gradient(10, 100)
    expect(Math.tan(g.degrees * Math.PI / 180) * 100).toBeCloseTo(10, 3)
  })

  it('returns zero for zero horizontal distance', () => {
    const g = gradient(10, 0)
    expect(g.percentage).toBe(0)
  })
})

describe('polarPoint', () => {
  it('bearing 0° moves point north', () => {
    const r = polarPoint({ easting: 100, northing: 100 }, 0, 50)
    expect(r.easting).toBeCloseTo(100, 3)
    expect(r.northing).toBeCloseTo(150, 3)
  })

  it('bearing 90° moves point east', () => {
    const r = polarPoint({ easting: 100, northing: 100 }, 90, 50)
    expect(r.easting).toBeCloseTo(150, 3)
    expect(r.northing).toBeCloseTo(100, 3)
  })
})
