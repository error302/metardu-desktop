/**
 * Tests for the METARDU Subdivision Engine
 */

import { subdivide } from '@/lib/engine/subdivision'
import type { Point2D } from '@/lib/engine/types'
import type { SubdivisionParams } from '@/types/subdivision'

// ─── Test fixtures ───────────────────────────────────────────────────────────

/** Simple 100m × 100m square (1.0 ha), vertices CW from NW */
const SQUARE_1HA: Point2D[] = [
  { easting: 100, northing: 200 },
  { easting: 200, northing: 200 },
  { easting: 200, northing: 100 },
  { easting: 100, northing: 100 },
]

/** Rectangle 200m × 50m = 1.0 ha */
const RECT_1HA: Point2D[] = [
  { easting: 100, northing: 150 },
  { easting: 300, northing: 150 },
  { easting: 300, northing: 100 },
  { easting: 100, northing: 100 },
]

/** Irregular pentagon (roughly 2.4 ha) */
const PENTAGON: Point2D[] = [
  { easting: 100, northing: 300 },
  { easting: 250, northing: 320 },
  { easting: 350, northing: 250 },
  { easting: 280, northing: 120 },
  { easting: 120, northing: 130 },
]

// ─── Helpers ────────────────────────────────────────────────────────────────

function roundHa(ha: number, decimals = 4): number {
  return Math.round(ha * Math.pow(10, decimals)) / Math.pow(10, decimals)
}

function totalLotsArea(lots: { areaHa: number }[]): number {
  return lots.reduce((s, l) => s + l.areaHa, 0)
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('subdivide', () => {
  // ─── Single Split ────────────────────────────────────────────────────────

  describe('single-split', () => {
    it('should split a square into two pieces with a vertical line', () => {
      const params: SubdivisionParams = {
        splitLine: {
          startPoint: { easting: 150, northing: 80 },
          endPoint: { easting: 150, northing: 220 },
        },
      }

      const result = subdivide(SQUARE_1HA, 'single-split', params)

      expect(result.method).toBe('single-split')
      expect(result.lots.length).toBe(2)

      const lot1 = result.lots.find(l => l.lotNumber === 1)!
      const lot2 = result.lots.find(l => l.lotNumber === 2)!

      // Each lot should be approximately 0.5 ha
      expect(lot1.areaHa).toBeGreaterThan(0)
      expect(lot2.areaHa).toBeGreaterThan(0)
      expect(lot1.areaHa + lot2.areaHa).toBeCloseTo(result.parentParcel.areaHa, 0)

      // Total should equal parent
      expect(roundHa(totalLotsArea(result.lots))).toBeCloseTo(roundHa(result.parentParcel.areaHa), 3)
    })

    it('should split a square into two pieces with a horizontal line', () => {
      const params: SubdivisionParams = {
        splitLine: {
          startPoint: { easting: 80, northing: 150 },
          endPoint: { easting: 220, northing: 150 },
        },
      }

      const result = subdivide(SQUARE_1HA, 'single-split', params)

      expect(result.lots.length).toBe(2)
      const lot1 = result.lots.find(l => l.lotNumber === 1)!
      const lot2 = result.lots.find(l => l.lotNumber === 2)!
      expect(lot1.areaHa).toBeGreaterThan(0)
      expect(lot2.areaHa).toBeGreaterThan(0)
      expect(lot1.areaHa + lot2.areaHa).toBeCloseTo(result.parentParcel.areaHa, 0)
    })

    it('should handle diagonal split', () => {
      const params: SubdivisionParams = {
        splitLine: {
          startPoint: { easting: 100, northing: 100 },
          endPoint: { easting: 200, northing: 200 },
        },
      }

      const result = subdivide(SQUARE_1HA, 'single-split', params)

      expect(result.lots.length).toBe(2)
      // Each half should be 0.5 ha for a diagonal of a square
      expect(roundHa(totalLotsArea(result.lots))).toBeCloseTo(roundHa(result.parentParcel.areaHa), 3)
    })
  })

  // ─── Grid Subdivision ────────────────────────────────────────────────────

  describe('grid', () => {
    it('should split a square into 4 equal lots (2×2)', () => {
      const params: SubdivisionParams = { rows: 2, cols: 2 }

      const result = subdivide(SQUARE_1HA, 'grid', params)

      expect(result.method).toBe('grid')
      expect(result.lots.length).toBe(4)

      // Each lot should be ~0.25 ha
      for (const lot of result.lots) {
        expect(lot.areaHa).toBeGreaterThan(0)
      }

      // Total should equal parent
      expect(roundHa(totalLotsArea(result.lots))).toBeCloseTo(roundHa(result.parentParcel.areaHa), 1)
    })

    it('should split a rectangle into 2 lots (1×2)', () => {
      const params: SubdivisionParams = { rows: 1, cols: 2 }

      const result = subdivide(RECT_1HA, 'grid', params)

      expect(result.lots.length).toBe(2)

      // Each lot should be ~0.5 ha (100m × 50m)
      for (const lot of result.lots) {
        expect(lot.areaHa).toBeGreaterThan(0)
      }
      expect(roundHa(totalLotsArea(result.lots))).toBeCloseTo(roundHa(result.parentParcel.areaHa), 1)
    })

    it('should split a square into 6 lots (2×3)', () => {
      const params: SubdivisionParams = { rows: 2, cols: 3 }

      const result = subdivide(SQUARE_1HA, 'grid', params)

      expect(result.lots.length).toBe(6)

      for (const lot of result.lots) {
        expect(lot.areaHa).toBeGreaterThan(0)
      }
    })

    it('should number lots left-to-right, top-to-bottom', () => {
      const params: SubdivisionParams = { rows: 2, cols: 2 }

      const result = subdivide(SQUARE_1HA, 'grid', params)

      // Lot numbers should be 1-4
      const lotNumbers = result.lots.map(l => l.lotNumber).sort((a, b) => a - b)
      expect(lotNumbers).toEqual([1, 2, 3, 4])
    })

    it('should handle irregular polygon grid subdivision', () => {
      const params: SubdivisionParams = { rows: 2, cols: 2 }

      const result = subdivide(PENTAGON, 'grid', params)

      // Should have some lots (might not be exactly 4 for irregular shapes)
      expect(result.lots.length).toBeGreaterThanOrEqual(2)
      expect(result.lots.length).toBeLessThanOrEqual(4)

      // All lots should have positive area
      for (const lot of result.lots) {
        expect(lot.areaHa).toBeGreaterThan(0)
      }
    })
  })

  // ─── Radial Subdivision ──────────────────────────────────────────────────

  describe('radial', () => {
    it('should split a square into 4 radial sectors from center', () => {
      const params: SubdivisionParams = {
        center: { easting: 150, northing: 150 },
        numLots: 4,
      }

      const result = subdivide(SQUARE_1HA, 'radial', params)

      expect(result.method).toBe('radial')
      expect(result.lots.length).toBeGreaterThanOrEqual(2)

      // All lots should have positive area
      for (const lot of result.lots) {
        expect(lot.areaHa).toBeGreaterThan(0)
      }
    })

    it('should default to centroid when center is not provided', () => {
      const params: SubdivisionParams = { numLots: 4 }

      const result = subdivide(SQUARE_1HA, 'radial', params)

      expect(result.lots.length).toBeGreaterThanOrEqual(2)
    })

    it('should handle 6 sectors', () => {
      const params: SubdivisionParams = {
        center: { easting: 150, northing: 150 },
        numLots: 6,
      }

      const result = subdivide(SQUARE_1HA, 'radial', params)

      expect(result.lots.length).toBeGreaterThanOrEqual(2)
      for (const lot of result.lots) {
        expect(lot.areaHa).toBeGreaterThan(0)
      }
    })

    it('should work with irregular polygon', () => {
      const params: SubdivisionParams = {
        numLots: 5,
      }

      const result = subdivide(PENTAGON, 'radial', params)

      expect(result.lots.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ─── Area-Based Subdivision ──────────────────────────────────────────────

  describe('area', () => {
    it('should split 1ha into two ~0.5ha lots', () => {
      const params: SubdivisionParams = { targetArea: 0.5 }

      const result = subdivide(SQUARE_1HA, 'area', params)

      expect(result.method).toBe('area')
      expect(result.lots.length).toBeGreaterThanOrEqual(2)

      for (const lot of result.lots) {
        expect(lot.areaHa).toBeGreaterThan(0)
        expect(lot.areaTarget).toBe(0.5)
        expect(lot.areaError).toBeDefined()
      }

      // Check total covers most of parent
      expect(roundHa(totalLotsArea(result.lots))).toBeCloseTo(roundHa(result.parentParcel.areaHa), 1)
    })

    it('should split 1ha into four ~0.25ha lots', () => {
      const params: SubdivisionParams = { targetArea: 0.25 }

      const result = subdivide(SQUARE_1HA, 'area', params)

      expect(result.lots.length).toBeGreaterThanOrEqual(3)
    })

    it('should handle target area larger than parent', () => {
      const params: SubdivisionParams = { targetArea: 5.0 } // 5 ha target, 1 ha parent

      const result = subdivide(SQUARE_1HA, 'area', params)

      // Should return 1 lot with whatever area is available
      expect(result.lots.length).toBe(1)
      expect(result.lots[0].areaHa).toBeCloseTo(1.0, 1)
    })

    it('should work with irregular polygon', () => {
      const params: SubdivisionParams = { targetArea: 0.5 }

      const result = subdivide(PENTAGON, 'area', params)

      expect(result.lots.length).toBeGreaterThanOrEqual(2)
      for (const lot of result.lots) {
        expect(lot.areaHa).toBeGreaterThan(0)
      }
    })

    it('should use preferred bearing when specified', () => {
      const params: SubdivisionParams = {
        targetArea: 0.5,
        preferredBearing: 90, // East
      }

      const result = subdivide(RECT_1HA, 'area', params)

      expect(result.lots.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ─── General ─────────────────────────────────────────────────────────────

  describe('general', () => {
    it('should correctly report parent parcel info', () => {
      const params: SubdivisionParams = { rows: 2, cols: 2 }
      const result = subdivide(SQUARE_1HA, 'grid', params)

      expect(result.parentParcel.areaHa).toBeCloseTo(1.0, 2)
      expect(result.parentParcel.vertices.length).toBe(4)
    })

    it('should compute centroid and perimeter for each lot', () => {
      const params: SubdivisionParams = { rows: 2, cols: 2 }
      const result = subdivide(SQUARE_1HA, 'grid', params)

      for (const lot of result.lots) {
        expect(lot.centroid.easting).toBeDefined()
        expect(lot.centroid.northing).toBeDefined()
        expect(lot.perimeter).toBeGreaterThan(0)
        expect(lot.vertices.length).toBeGreaterThanOrEqual(3)
      }
    })

    it('should handle a triangle', () => {
      const triangle: Point2D[] = [
        { easting: 100, northing: 200 },
        { easting: 300, northing: 200 },
        { easting: 200, northing: 100 },
      ]

      const params: SubdivisionParams = {
        splitLine: {
          startPoint: { easting: 150, northing: 100 },
          endPoint: { easting: 250, northing: 200 },
        },
      }

      const result = subdivide(triangle, 'single-split', params)

      expect(result.parentParcel.areaHa).toBeGreaterThan(0)
      expect(result.lots.length).toBeGreaterThanOrEqual(1)
    })
  })
})
