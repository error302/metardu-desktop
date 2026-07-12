/**
 * Tests for Phase 4: Corridor Engine + Surface TIN
 */

import {
  buildAlignment,
  enToChainageOffset,
  chainageOffsetToEN,
  organizeShotsByChainage,
  formatChainage,
  parseChainage,
  type PIPoint,
  type FieldShot,
} from '../corridorEngine'
import {
  buildTIN,
  interpolateZ,
  computeCutFill,
  computeStockpileVolume,
  type SurfacePoint,
} from '../surfaceTIN'

// ─── Corridor Engine ────────────────────────────────────────────────────────

describe('Corridor Engine', () => {
  // Simple north-south alignment: PI1 at (1000, 1000), PI2 at (1000, 2000)
  const pis: PIPoint[] = [
    { id: 'PI1', e: 1000, n: 1000 },
    { id: 'PI2', e: 1000, n: 2000 },
  ]
  const alignment = buildAlignment(pis)

  describe('buildAlignment', () => {
    it('computes segment length and bearing', () => {
      expect(alignment.segments).toHaveLength(1)
      expect(alignment.segments[0].length).toBe(1000)
      expect(alignment.segments[0].bearing).toBe(0) // due north
    })

    it('computes total length', () => {
      expect(alignment.totalLength).toBe(1000)
    })

    it('throws with < 2 PI points', () => {
      expect(() => buildAlignment([{ id: 'PI1', e: 0, n: 0 }])).toThrow()
    })
  })

  describe('enToChainageOffset', () => {
    it('computes chainage and offset for a point on the centerline', () => {
      const result = enToChainageOffset(alignment, 1000, 1500)
      expect(result.chainage).toBeCloseTo(500, 1)
      expect(result.offset).toBeCloseTo(0, 3)
    })

    it('computes positive offset for a point to the right (east)', () => {
      const result = enToChainageOffset(alignment, 1010, 1500)
      expect(result.chainage).toBeCloseTo(500, 1)
      expect(result.offset).toBeCloseTo(10, 1) // 10m east = right
    })

    it('computes negative offset for a point to the left (west)', () => {
      const result = enToChainageOffset(alignment, 990, 1500)
      expect(result.chainage).toBeCloseTo(500, 1)
      expect(result.offset).toBeCloseTo(-10, 1) // 10m west = left
    })

    it('computes chainage at the start point', () => {
      const result = enToChainageOffset(alignment, 1000, 1000)
      expect(result.chainage).toBeCloseTo(0, 1)
    })

    it('computes chainage at the end point', () => {
      const result = enToChainageOffset(alignment, 1000, 2000)
      expect(result.chainage).toBeCloseTo(1000, 1)
    })
  })

  describe('chainageOffsetToEN', () => {
    it('converts chainage/offset back to EN', () => {
      const result = chainageOffsetToEN(alignment, 500, 10)
      expect(result.easting).toBeCloseTo(1010, 1)
      expect(result.northing).toBeCloseTo(1500, 1)
    })

    it('centerline offset=0 gives CL coordinate', () => {
      const result = chainageOffsetToEN(alignment, 500, 0)
      expect(result.easting).toBeCloseTo(1000, 1)
      expect(result.northing).toBeCloseTo(1500, 1)
    })
  })

  describe('organizeShotsByChainage', () => {
    it('groups shots by chainage station', () => {
      const shots: FieldShot[] = [
        { e: 1000, n: 1000, rl: 1500, name: 'CL1', code: 'CL' },
        { e: 1010, n: 1000, rl: 1500, name: 'R1', code: 'RE' },
        { e: 990, n: 1000, rl: 1500, name: 'L1', code: 'LE' },
        { e: 1000, n: 1020, rl: 1500, name: 'CL2', code: 'CL' },
        { e: 1010, n: 1020, rl: 1500, name: 'R2', code: 'RE' },
      ]

      const groups = organizeShotsByChainage(shots, alignment, 20)
      expect(groups.length).toBeGreaterThanOrEqual(1)
      // Each group should have shots sorted by offset
      for (const g of groups) {
        for (let i = 1; i < g.shots.length; i++) {
          expect(g.shots[i].offset).toBeGreaterThanOrEqual(g.shots[i - 1].offset)
        }
      }
    })

    it('identifies the centerline shot (nearest offset=0)', () => {
      const shots: FieldShot[] = [
        { e: 990, n: 1000, rl: 1500.5, name: 'L', code: 'LE' },
        { e: 1000, n: 1000, rl: 1500.2, name: 'CL', code: 'CL' },
        { e: 1010, n: 1000, rl: 1500.8, name: 'R', code: 'RE' },
      ]

      const groups = organizeShotsByChainage(shots, alignment, 20)
      expect(groups[0].centrelineRL).toBe(1500.2) // the CL shot
    })

    it('formats chainage labels correctly', () => {
      const groups = organizeShotsByChainage(
        [{ e: 1000, n: 12450, rl: 1500 }],
        alignment,
        20,
      )
      // 12450m → '12+450'
      expect(groups[0].label).toMatch(/\d+\+\d+/)
    })
  })

  describe('formatChainage / parseChainage', () => {
    it('formats 12450 as 12+450', () => {
      expect(formatChainage(12450)).toBe('12+450')
    })

    it('parses 12+450 as 12450', () => {
      expect(parseChainage('12+450')).toBe(12450)
    })

    it('round-trips format → parse', () => {
      expect(parseChainage(formatChainage(5600))).toBe(5600)
    })

    it('parses plain numbers', () => {
      expect(parseChainage('1000')).toBe(1000)
    })
  })
})

// ─── Surface TIN ────────────────────────────────────────────────────────────

describe('Surface TIN', () => {
  const points: SurfacePoint[] = [
    { x: 0, y: 0, z: 10 },
    { x: 100, y: 0, z: 12 },
    { x: 0, y: 100, z: 11 },
    { x: 100, y: 100, z: 13 },
  ]

  describe('buildTIN', () => {
    it('builds a TIN with at least 2 triangles from 4 points', () => {
      const tin = buildTIN(points)
      expect(tin.triangles.length).toBeGreaterThanOrEqual(2)
      expect(tin.minX).toBe(0)
      expect(tin.maxX).toBe(100)
    })

    it('throws with < 3 points', () => {
      expect(() => buildTIN([points[0], points[1]])).toThrow()
    })
  })

  describe('interpolateZ', () => {
    it('interpolates Z at a point inside the TIN', () => {
      const tin = buildTIN(points)
      const z = interpolateZ(tin, 50, 50)
      // Center of the square should be roughly the average
      expect(z).not.toBeNull()
      expect(z!).toBeGreaterThan(9)
      expect(z!).toBeLessThan(14)
    })

    it('returns exact Z at a vertex', () => {
      const tin = buildTIN(points)
      const z = interpolateZ(tin, 0, 0)
      expect(z).toBeCloseTo(10, 5)
    })

    it('returns null for a point outside the TIN', () => {
      const tin = buildTIN(points)
      const z = interpolateZ(tin, 200, 200)
      expect(z).toBeNull()
    })
  })

  describe('computeCutFill', () => {
    it('computes cut when ground is above design', () => {
      // Design: flat at z=10
      const designPoints: SurfacePoint[] = [
        { x: 0, y: 0, z: 10 },
        { x: 100, y: 0, z: 10 },
        { x: 0, y: 100, z: 10 },
        { x: 100, y: 100, z: 10 },
      ]
      // Ground: flat at z=12 (2m above design → all cut)
      const groundPoints: SurfacePoint[] = [
        { x: 0, y: 0, z: 12 },
        { x: 100, y: 0, z: 12 },
        { x: 0, y: 100, z: 12 },
        { x: 100, y: 100, z: 12 },
      ]

      const designTIN = buildTIN(designPoints)
      const groundTIN = buildTIN(groundPoints)
      const result = computeCutFill(designTIN, groundTIN, 10)

      expect(result.cutVolume).toBeGreaterThan(0)
      expect(result.fillVolume).toBeCloseTo(0, 1)
      expect(result.netVolume).toBeGreaterThan(0) // net cut
      expect(result.cellCount).toBeGreaterThan(0)
    })

    it('computes fill when ground is below design', () => {
      // Design: flat at z=12
      // Ground: flat at z=10 (2m below design → all fill)
      const designPoints: SurfacePoint[] = [
        { x: 0, y: 0, z: 12 },
        { x: 100, y: 0, z: 12 },
        { x: 0, y: 100, z: 12 },
        { x: 100, y: 100, z: 12 },
      ]
      const groundPoints: SurfacePoint[] = [
        { x: 0, y: 0, z: 10 },
        { x: 100, y: 0, z: 10 },
        { x: 0, y: 100, z: 10 },
        { x: 100, y: 100, z: 10 },
      ]

      const result = computeCutFill(buildTIN(designPoints), buildTIN(groundPoints), 10)

      expect(result.fillVolume).toBeGreaterThan(0)
      expect(result.cutVolume).toBeCloseTo(0, 1)
      expect(result.netVolume).toBeLessThan(0) // net fill
    })

    it('returns zero volumes when surfaces dont overlap', () => {
      const designTIN = buildTIN([
        { x: 0, y: 0, z: 10 },
        { x: 100, y: 0, z: 10 },
        { x: 0, y: 100, z: 10 },
      ])
      const groundTIN = buildTIN([
        { x: 1000, y: 1000, z: 12 },
        { x: 1100, y: 1000, z: 12 },
        { x: 1000, y: 1100, z: 12 },
      ])

      const result = computeCutFill(designTIN, groundTIN, 10)
      expect(result.cutVolume).toBe(0)
      expect(result.fillVolume).toBe(0)
      expect(result.cellCount).toBe(0)
    })

    it('returns per-cell data for heat maps', () => {
      const result = computeCutFill(
        buildTIN([{ x: 0, y: 0, z: 10 }, { x: 100, y: 0, z: 10 }, { x: 0, y: 100, z: 10 }, { x: 100, y: 100, z: 10 }]),
        buildTIN([{ x: 0, y: 0, z: 12 }, { x: 100, y: 0, z: 12 }, { x: 0, y: 100, z: 12 }, { x: 100, y: 100, z: 12 }]),
        10,
      )
      expect(result.cells.length).toBeGreaterThan(0)
      expect(result.cells[0]).toHaveProperty('x')
      expect(result.cells[0]).toHaveProperty('diff')
      expect(result.cells[0]).toHaveProperty('volume')
    })
  })

  describe('computeStockpileVolume', () => {
    it('computes volume above a datum', () => {
      // A 2m high pile on a 100×100 area
      const pilePoints: SurfacePoint[] = [
        { x: 0, y: 0, z: 12 },
        { x: 100, y: 0, z: 12 },
        { x: 0, y: 100, z: 12 },
        { x: 100, y: 100, z: 12 },
      ]
      const tin = buildTIN(pilePoints)
      const result = computeStockpileVolume(tin, 10, 10) // datum = 10

      expect(result.volume).toBeGreaterThan(0)
      expect(result.avgHeight).toBeCloseTo(2, 0) // ~2m above datum
    })
  })
})
