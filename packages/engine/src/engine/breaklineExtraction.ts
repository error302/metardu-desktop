/**
 * Automated breakline extraction from a TIN mesh.
 *
 * Roadmap reference: docs/ROADMAP.md → Tier 2 → "Automated breakline
 * extraction". Algorithm: compute triangle normal vectors, flag sharp
 * dihedral-angle changes along shared edges, stitch candidate edges into
 * MultiLineStrings.
 *
 * Surveyors typically digitise breaklines in the field (toe-of-slope,
 * top-of-bank, kerb line, etc.), but for legacy data or photogrammetric
 * point clouds, automatic extraction saves hours of manual work.
 *
 * Algorithm:
 *   1. Build the TIN via `buildTINSurface` (or accept a pre-built one).
 *   2. For each triangle, compute the 3D unit normal vector.
 *   3. Build an edge → triangle(s) adjacency map.
 *   4. For each INTERIOR edge (shared by exactly 2 triangles):
 *        - Compute the dihedral angle = angle between the two normals
 *        - If dihedral > threshold, mark the edge as a breakline candidate
 *   5. Stitch candidate edges into ordered polylines (chains).
 *
 * Output: an array of polylines, each an array of {easting, northing}
 * points. Suitable for direct rendering on OpenLayers or for export as
 * GeoJSON LineStrings.
 *
 * References:
 *   - Sciutto, S. (2010) "Automatic breakline detection from TIN"
 *   - Yoshimura, T. (2016) "Feature line extraction from triangle meshes"
 */

import {
  buildTINSurface,
  type SpotHeight,
  type Breakline,
  type Triangle,
  type TINSurface,
} from '@/lib/engine/contours'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface BreaklineExtractionOptions {
  /**
   * Dihedral angle threshold in degrees. Edges where the dihedral angle
   * between adjacent triangle normals exceeds this value are flagged as
   * breakline candidates. Default: 30°.
   *
   * Lower → more sensitive (more breaklines). Higher → stricter (fewer).
   * Common presets:
   *   15° — ridge detection (sharp terrain)
   *   30° — general purpose (default)
   *   45° — only major slope changes (toe-of-bank)
   */
  thresholdDegrees?: number
  /**
   * Minimum polyline length in metres. Shorter polylines are discarded
   * as noise. Default: 0 (keep all).
   */
  minPolylineLength?: number
  /**
   * Maximum gap (in metres) between two candidate edge endpoints for them
   * to be stitched into the same polyline. Default: 0.01 m (1 cm).
   */
  stitchTolerance?: number
}

export interface ExtractedBreakline {
  /** Ordered polyline points (easting, northing). */
  points: Array<{ easting: number; northing: number }>
  /** Dihedral angle (degrees) — maximum along the polyline. */
  maxDihedral: number
  /** Mean dihedral angle (degrees) along the polyline. */
  meanDihedral: number
  /** Number of edges stitched into this polyline. */
  edgeCount: number
  /** Polyline length in metres (sum of segment lengths). */
  length: number
  /** Suggested classification based on dihedral angle. */
  classification: 'ridge' | 'slope-change' | 'minor'
}

export interface BreaklineExtractionResult {
  /** Stitched breaklines sorted by max dihedral (descending). */
  breaklines: ExtractedBreakline[]
  /** Total candidate edges (before stitching). */
  candidateEdgeCount: number
  /** Total interior edges examined. */
  interiorEdgeCount: number
  /** Total edges in the TIN (including boundary). */
  totalEdgeCount: number
  /** Threshold used (degrees). */
  threshold: number
}

// ─── Vector Math ────────────────────────────────────────────────────────────

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function length(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
}

function normalize(a: Vec3): Vec3 {
  const len = length(a)
  if (len < 1e-12) return { x: 0, y: 0, z: 0 }
  return { x: a.x / len, y: a.y / len, z: a.z / len }
}

/**
 * Compute the unit normal vector of a triangle (right-hand rule).
 * Returns (0,0,0) for degenerate triangles.
 */
export function triangleNormal(tri: Triangle): Vec3 {
  const p1 = toVec3(tri.p1)
  const p2 = toVec3(tri.p2)
  const p3 = toVec3(tri.p3)
  const u = subtract(p2, p1)
  const v = subtract(p3, p1)
  return normalize(cross(u, v))
}

function toVec3(p: SpotHeight): Vec3 {
  return { x: p.easting, y: p.northing, z: p.elevation }
}

/**
 * Compute the angle (degrees) between two triangle normals — i.e., the
 * "bend angle" of the surface along their shared edge.
 *
 *   0°   → normals are parallel → triangles are coplanar (flat terrain)
 *   90°  → normals are perpendicular → surface folds 90° (sharp ridge)
 *   180° → normals are anti-parallel → surface folds back on itself
 *
 * Note: this is the angle between normals, NOT the interior dihedral
 * angle (which is the supplementary, π − θ). For breakline detection
 * we want the bend angle: 0° = flat, larger = more folded.
 *
 * Callers should orient normals consistently (e.g., flip to point
 * upward) before calling this function to avoid false positives from
 * inconsistent triangle winding.
 */
export function dihedralAngle(n1: Vec3, n2: Vec3): number {
  const d = dot(n1, n2)
  // Clamp to [-1, 1] to avoid NaN from floating-point error
  const clamped = Math.max(-1, Math.min(1, d))
  return (Math.acos(clamped) * 180) / Math.PI
}

/**
 * Flip a normal so its Z component is non-negative. Used to give
 * inconsistently-wound triangles a consistent orientation before
 * computing dihedral angles.
 */
export function orientUpward(n: Vec3): Vec3 {
  return n.z < 0 ? { x: -n.x, y: -n.y, z: -n.z } : n
}

// ─── Edge Adjacency ─────────────────────────────────────────────────────────

interface EdgeKey {
  /** Canonical key: smaller index first, joined by '|'. */
  key: string
  a: SpotHeight
  b: SpotHeight
  triangleIndices: number[]
}

function edgeKey(p1: SpotHeight, p2: SpotHeight, pointIndex: Map<SpotHeight, number>): string {
  const i1 = pointIndex.get(p1) ?? -1
  const i2 = pointIndex.get(p2) ?? -1
  const lo = Math.min(i1, i2)
  const hi = Math.max(i1, i2)
  return `${lo}|${hi}`
}

function buildEdgeAdjacency(
  triangles: Triangle[],
  points: SpotHeight[]
): { edges: Map<string, EdgeKey>; pointIndex: Map<SpotHeight, number> } {
  const pointIndex = new Map<SpotHeight, number>()
  points.forEach((p, i) => pointIndex.set(p, i))

  const edges = new Map<string, EdgeKey>()
  for (let tIdx = 0; tIdx < triangles.length; tIdx++) {
    const tri = triangles[tIdx]
    const ePairs: [SpotHeight, SpotHeight][] = [
      [tri.p1, tri.p2],
      [tri.p2, tri.p3],
      [tri.p3, tri.p1],
    ]
    for (const [a, b] of ePairs) {
      const key = edgeKey(a, b, pointIndex)
      const existing = edges.get(key)
      if (existing) {
        existing.triangleIndices.push(tIdx)
      } else {
        edges.set(key, { key, a, b, triangleIndices: [tIdx] })
      }
    }
  }
  return { edges, pointIndex }
}

// ─── Extraction ─────────────────────────────────────────────────────────────

/** A single TIN edge flagged as a breakline candidate. */
interface CandidateEdge {
  a: { easting: number; northing: number }
  b: { easting: number; northing: number }
  dihedral: number
}

/**
 * Extract breaklines from a TIN mesh.
 *
 * @param surface  - TIN surface (use `buildTINSurface` to construct)
 * @param options  - Extraction options (threshold, min length, etc.)
 */
export function extractBreaklines(
  surface: TINSurface,
  options: BreaklineExtractionOptions = {}
): BreaklineExtractionResult {
  const threshold = options.thresholdDegrees ?? 30
  const minLen = options.minPolylineLength ?? 0
  const stitchTol = options.stitchTolerance ?? 0.01

  const { triangles, points } = surface
  if (triangles.length === 0) {
    return {
      breaklines: [],
      candidateEdgeCount: 0,
      interiorEdgeCount: 0,
      totalEdgeCount: 0,
      threshold,
    }
  }

  // 1. Compute triangle normals (oriented upward for consistent winding)
  const normals = triangles.map(t => orientUpward(triangleNormal(t)))

  // 2. Build edge adjacency
  const { edges } = buildEdgeAdjacency(triangles, points)
  const allEdges = Array.from(edges.values())
  const interiorEdges = allEdges.filter(e => e.triangleIndices.length === 2)

  // 3. For each interior edge, compute dihedral angle, collect candidates
  const candidates: CandidateEdge[] = []

  for (const edge of interiorEdges) {
    const [t1, t2] = edge.triangleIndices
    const angle = dihedralAngle(normals[t1], normals[t2])
    if (angle > threshold) {
      candidates.push({
        a: { easting: edge.a.easting, northing: edge.a.northing },
        b: { easting: edge.b.easting, northing: edge.b.northing },
        dihedral: angle,
      })
    }
  }

  // 4. Stitch candidate edges into polylines
  const breaklines = stitchCandidates(candidates, stitchTol)

  // 5. Filter by minimum length
  const filtered = breaklines.filter(bl => bl.length >= minLen)

  // 6. Sort by max dihedral (descending)
  filtered.sort((a, b) => b.maxDihedral - a.maxDihedral)

  return {
    breaklines: filtered,
    candidateEdgeCount: candidates.length,
    interiorEdgeCount: interiorEdges.length,
    totalEdgeCount: allEdges.length,
    threshold,
  }
}

/**
 * Convenience wrapper: build a TIN from raw points and extract breaklines.
 */
export function extractBreaklinesFromPoints(
  points: SpotHeight[],
  options: BreaklineExtractionOptions = {}
): BreaklineExtractionResult {
  const surface = buildTINSurface(points)
  return extractBreaklines(surface, options)
}

// ─── Stitching ──────────────────────────────────────────────────────────────

/**
 * Stitch candidate edges into ordered polylines.
 *
 * Uses a spatial hash on edge endpoints to find connected components.
 * Each connected component becomes one polyline. Branches (3+ edges
 * meeting at a point) are split into separate polylines.
 */
function stitchCandidates(
  candidates: CandidateEdge[],
  tolerance: number
): ExtractedBreakline[] {
  if (candidates.length === 0) return []

  const ptKey = (p: { easting: number; northing: number }): string =>
    `${Math.round(p.easting / tolerance)},${Math.round(p.northing / tolerance)}`

  // Build endpoint → candidate indices map
  const endpointMap = new Map<string, number[]>()
  candidates.forEach((c, i) => {
    const k1 = ptKey(c.a)
    const k2 = ptKey(c.b)
    if (!endpointMap.has(k1)) endpointMap.set(k1, [])
    if (!endpointMap.has(k2)) endpointMap.set(k2, [])
    endpointMap.get(k1)!.push(i)
    endpointMap.get(k2)!.push(i)
  })

  const used = new Array(candidates.length).fill(false)
  const polylines: ExtractedBreakline[] = []

  function tryExtend(
    polyline: Array<{ easting: number; northing: number }>,
    dihedrals: number[],
    fromStart: boolean
  ): void {
    let extended = true
    while (extended) {
      extended = false
      const endpoint = fromStart ? polyline[0] : polyline[polyline.length - 1]
      const key = ptKey(endpoint)
      const candidateIndices = endpointMap.get(key) || []
      for (const ci of candidateIndices) {
        if (used[ci]) continue
        const c = candidates[ci]
        // Match either endpoint
        const aMatches = ptsClose(c.a, endpoint, tolerance)
        const bMatches = ptsClose(c.b, endpoint, tolerance)
        if (aMatches) {
          if (fromStart) polyline.unshift(c.b)
          else polyline.push(c.b)
          dihedrals.push(c.dihedral)
          used[ci] = true
          extended = true
          break
        } else if (bMatches) {
          if (fromStart) polyline.unshift(c.a)
          else polyline.push(c.a)
          dihedrals.push(c.dihedral)
          used[ci] = true
          extended = true
          break
        }
      }
    }
  }

  for (let i = 0; i < candidates.length; i++) {
    if (used[i]) continue
    used[i] = true
    const polyline = [candidates[i].a, candidates[i].b]
    const dihedrals = [candidates[i].dihedral]

    // Extend forward (from end)
    tryExtend(polyline, dihedrals, false)
    // Extend backward (from start)
    tryExtend(polyline, dihedrals, true)

    // Compute stats
    const maxDihedral = Math.max(...dihedrals)
    const meanDihedral = dihedrals.reduce((a, b) => a + b, 0) / dihedrals.length
    const length = polylineLength(polyline)
    const classification: ExtractedBreakline['classification'] =
      maxDihedral >= 60 ? 'ridge' : maxDihedral >= 40 ? 'slope-change' : 'minor'

    polylines.push({
      points: polyline,
      maxDihedral,
      meanDihedral,
      edgeCount: dihedrals.length,
      length,
      classification,
    })
  }

  return polylines
}

function ptsClose(
  a: { easting: number; northing: number },
  b: { easting: number; northing: number },
  tol: number
): boolean {
  return (
    Math.abs(a.easting - b.easting) < tol * 100 &&
    Math.abs(a.northing - b.northing) < tol * 100
  )
}

function polylineLength(polyline: Array<{ easting: number; northing: number }>): number {
  let total = 0
  for (let i = 1; i < polyline.length; i++) {
    const dx = polyline[i].easting - polyline[i - 1].easting
    const dy = polyline[i].northing - polyline[i - 1].northing
    total += Math.sqrt(dx * dx + dy * dy)
  }
  return total
}

// ─── Conversion Helpers ─────────────────────────────────────────────────────

/**
 * Convert extracted breaklines to the Breakline[] format used by
 * `src/lib/engine/contours.ts` for use in further TIN re-computation.
 *
 * Note: extracted breaklines have 2D points only — elevation is set to
 * NaN because the extraction algorithm works in the XY plane. To use as
 * TIN constraints, the caller must interpolate elevations from the
 * original TIN surface.
 */
export function toBreaklineArray(
  result: BreaklineExtractionResult,
  elevations?: (easting: number, northing: number) => number | null
): Breakline[] {
  const out: Breakline[] = []
  for (const bl of result.breaklines) {
    if (bl.points.length < 2) continue
    for (let i = 0; i < bl.points.length - 1; i++) {
      const a = bl.points[i]
      const b = bl.points[i + 1]
      const z1 = elevations?.(a.easting, a.northing) ?? 0
      const z2 = elevations?.(b.easting, b.northing) ?? 0
      out.push({
        start: {
          name: `BL_${out.length}_a`,
          easting: a.easting,
          northing: a.northing,
          elevation: z1,
        },
        end: {
          name: `BL_${out.length}_b`,
          easting: b.easting,
          northing: b.northing,
          elevation: z2,
        },
      })
    }
  }
  return out
}

/**
 * Convert extracted breaklines to GeoJSON FeatureCollection of LineStrings.
 */
export function toGeoJSON(
  result: BreaklineExtractionResult
): {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: {
      type: 'LineString'
      coordinates: Array<[number, number]>
    }
    properties: {
      maxDihedral: number
      meanDihedral: number
      edgeCount: number
      length: number
      classification: string
    }
  }>
} {
  return {
    type: 'FeatureCollection',
    features: result.breaklines.map(bl => ({
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: bl.points.map(p => [p.easting, p.northing] as [number, number]),
      },
      properties: {
        maxDihedral: Math.round(bl.maxDihedral * 100) / 100,
        meanDihedral: Math.round(bl.meanDihedral * 100) / 100,
        edgeCount: bl.edgeCount,
        length: Math.round(bl.length * 1000) / 1000,
        classification: bl.classification,
      },
    })),
  }
}
