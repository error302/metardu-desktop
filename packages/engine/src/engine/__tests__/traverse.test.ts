import { bowditchAdjustment, transitAdjustment, forwardTraverse } from '../traverse'

const STANDARD_TRAVERSE = {
  points: [
    { name: 'A', easting: 1000.0, northing: 1000.0 },
    { name: 'B', easting: 0, northing: 0 },
    { name: 'C', easting: 0, northing: 0 },
    { name: 'D', easting: 0, northing: 0 },
    { name: 'E', easting: 0, northing: 0 },
  ],
  distances: [250.0, 310.0, 280.0, 260.0],
  bearings: [45.5, 120.3, 210.7, 310.2],
}

describe('bowditchAdjustment', () => {
  it('returns a result with the correct number of legs', () => {
    const r = bowditchAdjustment(STANDARD_TRAVERSE)
    expect(r.legs.length).toBe(4)
  })

  it('computes a precision ratio', () => {
    const r = bowditchAdjustment(STANDARD_TRAVERSE)
    expect(r.precisionRatio).toBeGreaterThan(0)
    // precisionRatio = perimeter/linearMisclosure (large number, e.g. 5000 means 1:5000)
    expect(r.precisionRatio).toBeGreaterThan(1)
  })

  it('adjusted coordinates are finite numbers', () => {
    const r = bowditchAdjustment(STANDARD_TRAVERSE)
    r.legs.forEach((leg: any) => {
      expect(Number.isFinite(leg.adjEasting)).toBe(true)
      expect(Number.isFinite(leg.adjNorthing)).toBe(true)
    })
  })

  it('sum of corrections equals closing error', () => {
    const r = bowditchAdjustment(STANDARD_TRAVERSE)
    const sumCorrE = r.legs.reduce((s, l) => s + l.correctionE, 0)
    const sumCorrN = r.legs.reduce((s, l) => s + l.correctionN, 0)
    expect(sumCorrE).toBeCloseTo(r.closingErrorE, 4)
    expect(sumCorrN).toBeCloseTo(r.closingErrorN, 4)
  })

  it('precision grade is a valid string', () => {
    const r = bowditchAdjustment(STANDARD_TRAVERSE)
    expect(['excellent', 'good', 'acceptable', 'poor']).toContain(r.precisionGrade)
  })

  it('total distance is sum of all leg distances', () => {
    const r = bowditchAdjustment(STANDARD_TRAVERSE)
    const expected = STANDARD_TRAVERSE.distances.reduce((a, b) => a + b, 0)
    expect(r.totalDistance).toBeCloseTo(expected, 4)
  })
})

describe('transitAdjustment', () => {
  it('returns same number of legs as bowditch', () => {
    const rb = bowditchAdjustment(STANDARD_TRAVERSE)
    const rt = transitAdjustment(STANDARD_TRAVERSE)
    expect(rt.legs.length).toBe(rb.legs.length)
  })

  it('closing errors match between methods (same input)', () => {
    const rb = bowditchAdjustment(STANDARD_TRAVERSE)
    const rt = transitAdjustment(STANDARD_TRAVERSE)
    // Both start with same misclosure
    expect(rb.linearError).toBeCloseTo(rt.linearError, 3)
  })
})

describe('forwardTraverse', () => {
  it('propagates coordinates from a known start point', () => {
    const r = forwardTraverse({
      start: { name: 'A', easting: 1000, northing: 2000 },
      stations: ['B'],
      distances: [100],
      bearings: [90], // due east
    })
    expect(r.end.easting).toBeCloseTo(1100, 3)
    expect(r.end.northing).toBeCloseTo(2000, 3)
  })

  it('bearing 0° moves due north', () => {
    const r = forwardTraverse({
      start: { name: 'A', easting: 500, northing: 500 },
      stations: ['B'],
      distances: [200],
      bearings: [0],
    })
    expect(r.end.northing).toBeCloseTo(700, 2)
    expect(r.end.easting).toBeCloseTo(500, 2)
  })

  it('total distance sums all legs', () => {
    const r = forwardTraverse({
      start: { name: 'A', easting: 0, northing: 0 },
      stations: ['B', 'C', 'D'],
      distances: [100, 150, 200],
      bearings: [45, 90, 135],
    })
    expect(r.totalDistance).toBeCloseTo(450, 4)
  })
})
