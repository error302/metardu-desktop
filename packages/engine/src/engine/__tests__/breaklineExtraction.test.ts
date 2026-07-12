/**
 * Tests for breaklineExtraction.ts
 *
 * Verifies:
 *   - Triangle normal computation (sign and direction)
 *   - Dihedral angle formula (flat, perpendicular, folded)
 *   - Edge adjacency (interior vs boundary edges)
 *   - Threshold filtering
 *   - Polyline stitching
 *   - GeoJSON / Breakline[] conversion
 *
 * Test cases use synthetic TINs with known geometry so the expected
 * dihedral angles can be computed analytically.
 */

import {
  triangleNormal,
  dihedralAngle,
  extractBreaklines,
  extractBreaklinesFromPoints,
  toBreaklineArray,
  toGeoJSON,
  type Vec3,
} from '../breaklineExtraction'
import { buildTINSurface, type SpotHeight, type Triangle } from '../contours'

// ─── Vector Math ────────────────────────────────────────────────────────────

describe('triangleNormal', () => {
  it('returns +Z for a counter-clockwise triangle in the XY plane', () => {
    const tri: Triangle = {
      p1: { name: 'a', easting: 0, northing: 0, elevation: 0 },
      p2: { name: 'b', easting: 1, northing: 0, elevation: 0 },
      p3: { name: 'c', easting: 0, northing: 1, elevation: 0 },
    }
    const n = triangleNormal(tri)
    expect(n.z).toBeCloseTo(1, 6)
    expect(n.x).toBeCloseTo(0, 6)
    expect(n.y).toBeCloseTo(0, 6)
  })

  it('returns a unit vector', () => {
    const tri: Triangle = {
      p1: { name: 'a', easting: 0, northing: 0, elevation: 0 },
      p2: { name: 'b', easting: 3, northing: 0, elevation: 4 },
      p3: { name: 'c', easting: 0, northing: 5, elevation: 0 },
    }
    const n = triangleNormal(tri)
    const len = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z)
    expect(len).toBeCloseTo(1, 6)
  })

  it('returns (0,0,0) for a degenerate triangle', () => {
    const tri: Triangle = {
      p1: { name: 'a', easting: 0, northing: 0, elevation: 0 },
      p2: { name: 'b', easting: 1, northing: 0, elevation: 0 },
      p3: { name: 'c', easting: 2, northing: 0, elevation: 0 }, // collinear
    }
    const n = triangleNormal(tri)
    expect(n.x).toBe(0)
    expect(n.y).toBe(0)
    expect(n.z).toBe(0)
  })
})

describe('dihedralAngle', () => {
  it('returns 0° for parallel normals (coplanar triangles)', () => {
    const n: Vec3 = { x: 0, y: 0, z: 1 }
    expect(dihedralAngle(n, n)).toBeCloseTo(0, 4)
  })

  it('returns 90° for perpendicular normals', () => {
    const n1: Vec3 = { x: 1, y: 0, z: 0 }
    const n2: Vec3 = { x: 0, y: 0, z: 1 }
    expect(dihedralAngle(n1, n2)).toBeCloseTo(90, 4)
  })

  it('returns 180° for anti-parallel normals (folded flat back)', () => {
    const n1: Vec3 = { x: 0, y: 0, z: 1 }
    const n2: Vec3 = { x: 0, y: 0, z: -1 }
    expect(dihedralAngle(n1, n2)).toBeCloseTo(180, 4)
  })

  it('returns the unsigned angle in [0, 180]', () => {
    // 45° tilt
    const n1: Vec3 = { x: 0, y: 0, z: 1 }
    const cos45 = Math.cos(Math.PI / 4)
    const n2: Vec3 = { x: cos45, y: 0, z: cos45 }
    expect(dihedralAngle(n1, n2)).toBeCloseTo(45, 2)
  })
})

// ─── Synthetic TIN ──────────────────────────────────────────────────────────

/**
 * Build a synthetic TIN with a known ridge running along the middle column.
 *
 *   p1(100) ── p2(110) ── p3(100)     elevation: corners 100, ridge 110
 *      │  T1    │   T2    │             ↘ ridge along p2-p5 (middle column)
 *   p4(100) ── p5(110) ── p6(100)     Both side pairs of triangles fold
 *                                     along the central ridge edge.
 */
function buildRidgeTIN(): { surface: ReturnType<typeof buildTINSurface>; points: SpotHeight[] } {
  const points: SpotHeight[] = [
    { name: 'p1', easting: 0, northing: 10, elevation: 100 },
    { name: 'p2', easting: 5, northing: 10, elevation: 110 },
    { name: 'p3', easting: 10, northing: 10, elevation: 100 },
    { name: 'p4', easting: 0, northing: 0, elevation: 100 },
    { name: 'p5', easting: 5, northing: 0, elevation: 110 },
    { name: 'p6', easting: 10, northing: 0, elevation: 100 },
  ]
  return { surface: buildTINSurface(points), points }
}

describe('extractBreaklines — synthetic ridge TIN', () => {
  it('detects at least one breakline above the 30° threshold', () => {
    const { surface } = buildRidgeTIN()
    const result = extractBreaklines(surface, { thresholdDegrees: 30 })
    expect(result.breaklines.length).toBeGreaterThan(0)
    expect(result.candidateEdgeCount).toBeGreaterThan(0)
    expect(result.interiorEdgeCount).toBeGreaterThan(0)
  })

  it('returns no breaklines when threshold is 180°', () => {
    const { surface } = buildRidgeTIN()
    const result = extractBreaklines(surface, { thresholdDegrees: 180 })
    expect(result.breaklines).toEqual([])
    expect(result.candidateEdgeCount).toBe(0)
  })

  it('returns more breaklines with a lower threshold', () => {
    const { surface } = buildRidgeTIN()
    const strict = extractBreaklines(surface, { thresholdDegrees: 60 })
    const loose = extractBreaklines(surface, { thresholdDegrees: 10 })
    expect(loose.candidateEdgeCount).toBeGreaterThanOrEqual(strict.candidateEdgeCount)
  })

  it('each breakline has a non-empty points array and non-negative dihedral', () => {
    const { surface } = buildRidgeTIN()
    const result = extractBreaklines(surface, { thresholdDegrees: 30 })
    for (const bl of result.breaklines) {
      expect(bl.points.length).toBeGreaterThanOrEqual(2)
      expect(bl.maxDihedral).toBeGreaterThan(30)
      expect(bl.meanDihedral).toBeGreaterThan(0)
      expect(bl.edgeCount).toBeGreaterThan(0)
      expect(bl.length).toBeGreaterThan(0)
    }
  })

  it('respects minPolylineLength filter', () => {
    const { surface } = buildRidgeTIN()
    const result = extractBreaklines(surface, {
      thresholdDegrees: 30,
      minPolylineLength: 100, // longer than the test ridge
    })
    // All polylines should be filtered out (ridge is ~5–10 m long)
    expect(result.breaklines.length).toBe(0)
  })
})

// ─── Edge Cases ─────────────────────────────────────────────────────────────

describe('extractBreaklines edge cases', () => {
  it('returns empty for an empty TIN', () => {
    const surface = buildTINSurface([])
    const result = extractBreaklines(surface)
    expect(result.breaklines).toEqual([])
    expect(result.candidateEdgeCount).toBe(0)
    expect(result.interiorEdgeCount).toBe(0)
    expect(result.totalEdgeCount).toBe(0)
  })

  it('returns empty for fewer than 3 points', () => {
    const points: SpotHeight[] = [
      { name: 'a', easting: 0, northing: 0, elevation: 0 },
      { name: 'b', easting: 1, northing: 0, elevation: 0 },
    ]
    const result = extractBreaklinesFromPoints(points)
    expect(result.breaklines).toEqual([])
  })

  it('returns empty for a perfectly flat TIN (all elevations equal)', () => {
    const points: SpotHeight[] = [
      { name: 'a', easting: 0, northing: 0, elevation: 100 },
      { name: 'b', easting: 10, northing: 0, elevation: 100 },
      { name: 'c', easting: 0, northing: 10, elevation: 100 },
      { name: 'd', easting: 10, northing: 10, elevation: 100 },
    ]
    const result = extractBreaklinesFromPoints(points, { thresholdDegrees: 10 })
    // All normals point straight up → all dihedral angles = 0 → no candidates
    expect(result.candidateEdgeCount).toBe(0)
    expect(result.breaklines).toEqual([])
  })
})

// ─── Conversion Helpers ─────────────────────────────────────────────────────

describe('toBreaklineArray', () => {
  it('produces one Breakline per polyline segment', () => {
    const { surface } = buildRidgeTIN()
    const result = extractBreaklines(surface, { thresholdDegrees: 30 })
    const arr = toBreaklineArray(result)
    // At least one segment (since we have ≥1 breakline with ≥2 points)
    expect(arr.length).toBeGreaterThan(0)
    for (const b of arr) {
      expect(typeof b.start.easting).toBe('number')
      expect(typeof b.end.easting).toBe('number')
    }
  })

  it('uses the elevations callback when supplied', () => {
    const { surface } = buildRidgeTIN()
    const result = extractBreaklines(surface, { thresholdDegrees: 30 })
    const arr = toBreaklineArray(result, (_e, _n) => 42)
    for (const b of arr) {
      expect(b.start.elevation).toBe(42)
      expect(b.end.elevation).toBe(42)
    }
  })
})

describe('toGeoJSON', () => {
  it('returns a valid GeoJSON FeatureCollection of LineStrings', () => {
    const { surface } = buildRidgeTIN()
    const result = extractBreaklines(surface, { thresholdDegrees: 30 })
    const gj = toGeoJSON(result)
    expect(gj.type).toBe('FeatureCollection')
    expect(Array.isArray(gj.features)).toBe(true)
    expect(gj.features.length).toBe(result.breaklines.length)
    for (const f of gj.features) {
      expect(f.type).toBe('Feature')
      expect(f.geometry.type).toBe('LineString')
      expect(f.geometry.coordinates.length).toBeGreaterThanOrEqual(2)
      // Each coordinate is [easting, northing]
      for (const c of f.geometry.coordinates) {
        expect(c.length).toBe(2)
        expect(typeof c[0]).toBe('number')
        expect(typeof c[1]).toBe('number')
      }
      // Properties include dihedral and classification
      expect(f.properties).toHaveProperty('maxDihedral')
      expect(f.properties).toHaveProperty('classification')
    }
  })

  it('returns an empty FeatureCollection when no breaklines are found', () => {
    const result = extractBreaklines(buildTINSurface([]))
    const gj = toGeoJSON(result)
    expect(gj.features).toEqual([])
  })
})

// ─── Classification ─────────────────────────────────────────────────────────

describe('classification thresholds', () => {
  it('assigns "ridge" to breaklines with maxDihedral >= 60°', () => {
    // Build a near-vertical fold (180° dihedral)
    const points: SpotHeight[] = [
      { name: 'a', easting: 0, northing: 0, elevation: 0 },
      { name: 'b', easting: 5, northing: 0, elevation: 50 }, // top of ridge
      { name: 'c', easting: 10, northing: 0, elevation: 0 },
      { name: 'd', easting: 0, northing: 5, elevation: 0 },
      { name: 'e', easting: 5, northing: 5, elevation: 50 },
      { name: 'f', easting: 10, northing: 5, elevation: 0 },
    ]
    const result = extractBreaklinesFromPoints(points, { thresholdDegrees: 30 })
    const ridges = result.breaklines.filter(b => b.classification === 'ridge')
    expect(ridges.length).toBeGreaterThan(0)
  })
})
