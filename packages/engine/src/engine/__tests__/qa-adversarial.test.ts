import { polar2D } from '../polar'
import { distanceBearing } from '../distance'
import { coordinateArea } from '../area'

describe('Adversarial QA Testing - Phase 1', () => {
  describe('1A. COGO (Coordinate Geometry)', () => {
    it('Test 1: Simple forward computation', () => {
      const p = polar2D({ station: { easting: 500000, northing: 9840000 }, bearing: 45, horizontalDistance: 100 })
      expect(p.easting).toBeCloseTo(500070.711, 3)
      expect(p.northing).toBeCloseTo(9840070.711, 3)
      
      const { distance } = distanceBearing({ easting: 500000, northing: 9840000 }, p)
      expect(distance).toBeCloseTo(100.000, 3)
    })

    it('Test 2: All 8 cardinal directions', () => {
      const tests = [
        { brg: 0, expE: 300000.000, expN: 9900050.000 },
        { brg: 45, expE: 300035.355, expN: 9900035.355 },
        { brg: 90, expE: 300050.000, expN: 9900000.000 },
        { brg: 135, expE: 300035.355, expN: 9899964.645 },
        { brg: 180, expE: 300000.000, expN: 9899950.000 },
        { brg: 225, expE: 299964.645, expN: 9899964.645 },
        { brg: 270, expE: 299950.000, expN: 9900000.000 },
        { brg: 315, expE: 299964.645, expN: 9900035.355 }
      ]

      tests.forEach(t => {
        const p = polar2D({ station: { easting: 300000, northing: 9900000 }, bearing: t.brg, horizontalDistance: 50 })
        expect(p.easting).toBeCloseTo(t.expE, 3)
        expect(p.northing).toBeCloseTo(t.expN, 3)
      })
    })

    it('Test 3: Very short distances (sub-millimetre precision)', () => {
      const p = polar2D({ station: { easting: 0, northing: 0 }, bearing: 30.26263889, horizontalDistance: 0.001 }) // 30° 15' 45.5"
      expect(p.easting).toBeCloseTo(0.001 * Math.sin(30.26263889 * Math.PI / 180), 6)
      expect(p.northing).toBeCloseTo(0.001 * Math.cos(30.26263889 * Math.PI / 180), 6)
    })

    it('Test 4: Very long distances (10 km traverse leg)', () => {
      const p = polar2D({ station: { easting: 0, northing: 0 }, bearing: 270.0, horizontalDistance: 10000.0 })
      expect(p.easting).toBeCloseTo(-10000.0, 3)
      expect(p.northing).toBeCloseTo(0.0, 3)
    })

    it('Test 5: Adversarial — nearly identical points', () => {
      const p1 = { easting: 500000.001, northing: 9840000.001 }
      const p2 = { easting: 500000.002, northing: 9840000.002 }
      const { distance, bearing } = distanceBearing(p1, p2)
      expect(distance).toBeCloseTo(0.001414, 6)
      expect(bearing).toBeCloseTo(45.0, 3)
    })

    it('Test 6: Cross-quadrant bearing', () => {
      const p1 = { easting: 400000, northing: 9900000 }
      const p2 = { easting: 600000, northing: 9890000 }
      const { bearing } = distanceBearing(p1, p2)
      const expectedBearing = 180 + Math.atan(200000 / -10000) * 180 / Math.PI
      expect(bearing).toBeCloseTo(expectedBearing, 3)
    })

    it('Test 11: Area by coordinates', () => {
      const rect = [{easting:0, northing:0}, {easting:100, northing:0}, {easting:100, northing:50}, {easting:0, northing:50}]
      expect(coordinateArea(rect).areaSqm).toBeCloseTo(5000, 3)
      const tri = [{easting:0, northing:0}, {easting:100, northing:0}, {easting:50, northing:86.603}]
      expect(coordinateArea(tri).areaSqm).toBeCloseTo(4330.15, 2)
    })
  })
})
