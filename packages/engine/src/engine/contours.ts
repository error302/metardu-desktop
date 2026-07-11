/**
 * METARDU Contour Engine — Delaunay TIN + Marching Triangles
 *
 * Phase 25 upgrade: replaces O(n³) brute-force triangulation with
 * Delaunator-based Delaunay triangulation. Handles 10,000+ points.
 *
 * Features:
 *  - Delaunay triangulation via Delaunator (O(n log n))
 *  - Breakline enforcement via edge constraint (flip edges that cross breaklines)
 *  - Contour line threading (ordered polylines, not loose pairs)
 *  - TIN surface interpolation at any (E, N) point
 *  - Index contour marking (every 5th contour)
 *
 * Source: Ghilani & Wolf, Elementary Surveying 16th Ed., Chapter 17
 * Source: USACE EM 1110-1-1005 — Topographic Survey Standards
 */

import Delaunator from 'delaunator'

export interface SpotHeight {
  name: string
  easting: number
  northing: number
  elevation: number
}

export interface ContourLine {
  elevation: number
  points: Array<{ easting: number; northing: number }>
  isIndex: boolean
}

export interface Triangle {
  p1: SpotHeight
  p2: SpotHeight
  p3: SpotHeight
}

export interface Breakline {
  start: SpotHeight
  end: SpotHeight
}

export interface TINSurface {
  triangles: Triangle[]
  points: SpotHeight[]
  bounds: { minE: number; maxE: number; minN: number; maxN: number }
}

// ─── Delaunay Triangulation ─────────────────────────────────────────────────

/**
 * Build a Delaunay TIN from spot heights using Delaunator.
 * O(n log n) — handles thousands of points efficiently.
 */
export function triangulate(points: SpotHeight[]): Triangle[] {
  if (points.length < 3) return []

  // Delaunator expects flat coordinate array [x0,y0, x1,y1, ...]
  const coords = new Float64Array(points.length * 2)
  for (let i = 0; i < points.length; i++) {
    coords[2 * i] = points[i].easting
    coords[2 * i + 1] = points[i].northing
  }

  let delaunay: Delaunator<Float64Array>
  try {
    delaunay = new Delaunator(coords)
  } catch {
    // Fallback: all points may be collinear
    return []
  }

  const triangles: Triangle[] = []
  const triIndices = delaunay.triangles

  for (let i = 0; i < triIndices.length; i += 3) {
    const a = triIndices[i]
    const b = triIndices[i + 1]
    const c = triIndices[i + 2]

    // Skip degenerate triangles (zero area)
    const area = Math.abs(
      (points[b].easting - points[a].easting) * (points[c].northing - points[a].northing) -
      (points[c].easting - points[a].easting) * (points[b].northing - points[a].northing)
    )
    if (area < 1e-10) continue

    triangles.push({
      p1: points[a],
      p2: points[b],
      p3: points[c],
    })
  }

  return triangles
}

/**
 * Build a full TIN surface object with bounds metadata.
 */
export function buildTINSurface(points: SpotHeight[], breaklines?: Breakline[]): TINSurface {
  let triangles = triangulate(points)

  // Apply breakline constraints if provided
  if (breaklines && breaklines.length > 0) {
    triangles = enforceBreaklines(triangles, breaklines, points)
  }

  let minE = Infinity, maxE = -Infinity
  let minN = Infinity, maxN = -Infinity
  for (const p of points) {
    if (p.easting < minE) minE = p.easting
    if (p.easting > maxE) maxE = p.easting
    if (p.northing < minN) minN = p.northing
    if (p.northing > maxN) maxN = p.northing
  }

  return {
    triangles,
    points,
    bounds: { minE, maxE, minN, maxN },
  }
}

// ─── Breakline Enforcement ──────────────────────────────────────────────────

/**
 * Enforce breaklines by removing triangles whose edges cross breaklines
 * and rebuilding with breakline vertices inserted.
 *
 * Simple approach: for each breakline, check if any triangle edge crosses it.
 * If so, split the crossing edge at the intersection and re-triangulate the
 * affected region. This is a simplified constrained Delaunay approach.
 */
function enforceBreaklines(
  triangles: Triangle[],
  breaklines: Breakline[],
  points: SpotHeight[]
): Triangle[] {
  // For each breakline, check triangle edges
  // If a triangle edge crosses a breakline, flip it if the resulting
  // triangulation would not violate the breakline constraint
  let result = [...triangles]

  for (const bl of breaklines) {
    const newTriangles: Triangle[] = []

    for (const tri of result) {
      const edges: [SpotHeight, SpotHeight][] = [
        [tri.p1, tri.p2],
        [tri.p2, tri.p3],
        [tri.p3, tri.p1],
      ]

      let crosses = false
      for (const [a, b] of edges) {
        if (edgesCross(a, b, bl.start, bl.end)) {
          crosses = true
          break
        }
      }

      if (!crosses) {
        newTriangles.push(tri)
      } else {
        // Split triangle along breakline intersection
        const split = splitTriangleByBreakline(tri, bl, points)
        newTriangles.push(...split)
      }
    }

    result = newTriangles
  }

  return result
}

/** Check if two line segments cross (proper intersection, not touching). */
function edgesCross(
  a1: SpotHeight, a2: SpotHeight,
  b1: SpotHeight, b2: SpotHeight
): boolean {
  const d1 = cross2D(b1, b2, a1)
  const d2 = cross2D(b1, b2, a2)
  const d3 = cross2D(a1, a2, b1)
  const d4 = cross2D(a1, a2, b2)

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }

  return false
}

function cross2D(o: SpotHeight, a: SpotHeight, b: SpotHeight): number {
  return (a.easting - o.easting) * (b.northing - o.northing) -
         (a.northing - o.northing) * (b.easting - o.easting)
}

/**
 * Split a triangle that is crossed by a breakline.
 * Finds the intersection point and creates sub-triangles.
 */
function splitTriangleByBreakline(
  tri: Triangle,
  bl: Breakline,
  points: SpotHeight[]
): Triangle[] {
  const edges: [SpotHeight, SpotHeight, SpotHeight][] = [
    [tri.p1, tri.p2, tri.p3],
    [tri.p2, tri.p3, tri.p1],
    [tri.p3, tri.p1, tri.p2],
  ]

  for (const [a, b, c] of edges) {
    if (edgesCross(a, b, bl.start, bl.end)) {
      const inter = lineLineIntersection(a, b, bl.start, bl.end)
      if (!inter) continue

      // Interpolate elevation at intersection point
      const t = Math.sqrt(
        (inter.easting - a.easting) ** 2 + (inter.northing - a.northing) ** 2
      ) / Math.sqrt(
        (b.easting - a.easting) ** 2 + (b.northing - a.northing) ** 2
      )
      const elev = a.elevation + t * (b.elevation - a.elevation)

      const interPt: SpotHeight = {
        name: `BL_${points.length}`,
        easting: inter.easting,
        northing: inter.northing,
        elevation: elev,
      }

      // Create two sub-triangles
      return [
        { p1: a, p2: interPt, p3: c },
        { p1: interPt, p2: b, p3: c },
      ]
    }
  }

  // No crossing found (edge case) — return original
  return [tri]
}

function lineLineIntersection(
  a1: SpotHeight, a2: SpotHeight,
  b1: SpotHeight, b2: SpotHeight
): { easting: number; northing: number } | null {
  const dx1 = a2.easting - a1.easting
  const dy1 = a2.northing - a1.northing
  const dx2 = b2.easting - b1.easting
  const dy2 = b2.northing - b1.northing

  const denom = dx1 * dy2 - dy1 * dx2
  if (Math.abs(denom) < 1e-12) return null

  const t = ((b1.easting - a1.easting) * dy2 - (b1.northing - a1.northing) * dx2) / denom

  return {
    easting: a1.easting + t * dx1,
    northing: a1.northing + t * dy1,
  }
}

// ─── Contour Generation (Marching Triangles) ────────────────────────────────

function interpolateEdge(
  p1: SpotHeight,
  p2: SpotHeight,
  contourElev: number
): { easting: number; northing: number } | null {
  const minElev = Math.min(p1.elevation, p2.elevation)
  const maxElev = Math.max(p1.elevation, p2.elevation)

  if (contourElev <= minElev || contourElev >= maxElev) return null

  const t = (contourElev - p1.elevation) / (p2.elevation - p1.elevation)

  return {
    easting: p1.easting + t * (p2.easting - p1.easting),
    northing: p1.northing + t * (p2.northing - p1.northing)
  }
}

/**
 * Generate contour lines from spot heights using Delaunay TIN.
 *
 * Algorithm: Marching Triangles
 * 1. Build Delaunay triangulation
 * 2. For each contour elevation, walk through all triangles
 * 3. Find edge crossings and collect contour segments
 * 4. Thread segments into ordered polylines
 *
 * @param points - Array of spot heights
 * @param interval - Contour interval in metres
 * @param indexInterval - Index contour interval (default: 5× interval)
 * @param breaklines - Optional breaklines to constrain the TIN
 */
export function generateContours(
  points: SpotHeight[],
  interval: number,
  indexInterval?: number,
  breaklines?: Breakline[]
): ContourLine[] {
  if (points.length < 3) return []

  const effectiveIndexInterval = indexInterval ?? interval * 5

  // Build TIN
  let triangles: Triangle[]
  if (breaklines && breaklines.length > 0) {
    const surface = buildTINSurface(points, breaklines)
    triangles = surface.triangles
  } else {
    triangles = triangulate(points)
  }

  if (triangles.length === 0) return []

  const elevations = points.map(p => p.elevation)
  const minElev = Math.min(...elevations)
  const maxElev = Math.max(...elevations)

  const firstContour = Math.ceil(minElev / interval) * interval
  const contourElevations: number[] = []
  for (let e = firstContour; e <= maxElev; e += interval) {
    contourElevations.push(Math.round(e * 1e6) / 1e6) // avoid floating point drift
  }

  const contourLines: ContourLine[] = []

  for (const contourElev of contourElevations) {
    // Collect contour segments from all triangles
    const segments: Array<[
      { easting: number; northing: number },
      { easting: number; northing: number }
    ]> = []

    for (const tri of triangles) {
      const edges: [SpotHeight, SpotHeight][] = [
        [tri.p1, tri.p2],
        [tri.p2, tri.p3],
        [tri.p3, tri.p1]
      ]

      const crossings: Array<{ easting: number; northing: number }> = []

      for (const [a, b] of edges) {
        const crossing = interpolateEdge(a, b, contourElev)
        if (crossing) crossings.push(crossing)
      }

      if (crossings.length === 2) {
        segments.push([crossings[0], crossings[1]])
      }
    }

    if (segments.length > 0) {
      // Thread segments into ordered polylines
      const polylines = threadSegments(segments)

      for (const polyline of polylines) {
        if (polyline.length >= 2) {
          const isIndex = Math.abs(contourElev % effectiveIndexInterval) < interval * 0.01

          contourLines.push({
            elevation: contourElev,
            points: polyline,
            isIndex,
          })
        }
      }
    }
  }

  return contourLines
}

/**
 * Thread unordered line segments into ordered polylines.
 *
 * Uses a spatial hash to efficiently find matching endpoints.
 * Produces continuous polylines by connecting segments whose
 * endpoints are within a small tolerance.
 */
function threadSegments(
  segments: Array<[
    { easting: number; northing: number },
    { easting: number; northing: number }
  ]>
): Array<Array<{ easting: number; northing: number }>> {
  if (segments.length === 0) return []

  const TOLERANCE = 1e-6
  const used = new Array(segments.length).fill(false)
  const polylines: Array<Array<{ easting: number; northing: number }>> = []

  function ptKey(p: { easting: number; northing: number }): string {
    return `${Math.round(p.easting / TOLERANCE)},${Math.round(p.northing / TOLERANCE)}`
  }

  function ptsMatch(
    a: { easting: number; northing: number },
    b: { easting: number; northing: number }
  ): boolean {
    return Math.abs(a.easting - b.easting) < TOLERANCE * 100 &&
           Math.abs(a.northing - b.northing) < TOLERANCE * 100
  }

  // Build spatial index: endpoint key → segment indices
  const endpointMap = new Map<string, number[]>()
  for (let i = 0; i < segments.length; i++) {
    const k0 = ptKey(segments[i][0])
    const k1 = ptKey(segments[i][1])
    if (!endpointMap.has(k0)) endpointMap.set(k0, [])
    if (!endpointMap.has(k1)) endpointMap.set(k1, [])
    endpointMap.get(k0)!.push(i)
    endpointMap.get(k1)!.push(i)
  }

  for (let startIdx = 0; startIdx < segments.length; startIdx++) {
    if (used[startIdx]) continue

    used[startIdx] = true
    const polyline = [segments[startIdx][0], segments[startIdx][1]]

    // Extend forward from end
    let extended = true
    while (extended) {
      extended = false
      const endPt = polyline[polyline.length - 1]
      const key = ptKey(endPt)
      const candidates = endpointMap.get(key) || []

      for (const ci of candidates) {
        if (used[ci]) continue
        const seg = segments[ci]

        if (ptsMatch(seg[0], endPt)) {
          polyline.push(seg[1])
          used[ci] = true
          extended = true
          break
        }
        if (ptsMatch(seg[1], endPt)) {
          polyline.push(seg[0])
          used[ci] = true
          extended = true
          break
        }
      }
    }

    // Extend backward from start
    extended = true
    while (extended) {
      extended = false
      const startPt = polyline[0]
      const key = ptKey(startPt)
      const candidates = endpointMap.get(key) || []

      for (const ci of candidates) {
        if (used[ci]) continue
        const seg = segments[ci]

        if (ptsMatch(seg[0], startPt)) {
          polyline.unshift(seg[1])
          used[ci] = true
          extended = true
          break
        }
        if (ptsMatch(seg[1], startPt)) {
          polyline.unshift(seg[0])
          used[ci] = true
          extended = true
          break
        }
      }
    }

    polylines.push(polyline)
  }

  return polylines
}

// ─── TIN Surface Interpolation ──────────────────────────────────────────────

/**
 * Interpolate elevation at a point (E, N) using the TIN surface.
 * Uses barycentric coordinates within the containing triangle.
 *
 * Returns null if the point falls outside the TIN.
 */
export function interpolateElevation(
  surface: TINSurface,
  easting: number,
  northing: number
): number | null {
  for (const tri of surface.triangles) {
    const elev = barycentricInterpolation(tri, easting, northing)
    if (elev !== null) return elev
  }
  return null
}

/**
 * Barycentric interpolation within a triangle.
 * Returns the interpolated elevation if point is inside, null otherwise.
 */
function barycentricInterpolation(
  tri: Triangle,
  e: number,
  n: number
): number | null {
  const { p1, p2, p3 } = tri

  const denom = (p2.northing - p3.northing) * (p1.easting - p3.easting) +
                (p3.easting - p2.easting) * (p1.northing - p3.northing)

  if (Math.abs(denom) < 1e-12) return null

  const w1 = ((p2.northing - p3.northing) * (e - p3.easting) +
              (p3.easting - p2.easting) * (n - p3.northing)) / denom

  const w2 = ((p3.northing - p1.northing) * (e - p3.easting) +
              (p1.easting - p3.easting) * (n - p3.northing)) / denom

  const w3 = 1 - w1 - w2

  // Check if point is inside triangle (with small tolerance for edges)
  const eps = -1e-8
  if (w1 < eps || w2 < eps || w3 < eps) return null

  return w1 * p1.elevation + w2 * p2.elevation + w3 * p3.elevation
}

// ─── Volume Computation from TIN ────────────────────────────────────────────

/**
 * Compute the volume between a TIN surface and a reference plane.
 *
 * @param surface - TIN surface
 * @param referencePlane - Elevation of the reference plane (m)
 * @returns { cut, fill, net } volumes in cubic metres
 */
export function computeVolumeFromTIN(
  surface: TINSurface,
  referencePlane: number
): { cut: number; fill: number; net: number } {
  let cut = 0
  let fill = 0

  for (const tri of surface.triangles) {
    // Average elevation of triangle
    const avgElev = (tri.p1.elevation + tri.p2.elevation + tri.p3.elevation) / 3

    // Triangle area (horizontal projection)
    const area = Math.abs(
      (tri.p2.easting - tri.p1.easting) * (tri.p3.northing - tri.p1.northing) -
      (tri.p3.easting - tri.p1.easting) * (tri.p2.northing - tri.p1.northing)
    ) / 2

    // Prismoidal volume for this triangle
    const diff = avgElev - referencePlane
    const vol = area * Math.abs(diff)

    if (diff > 0) {
      cut += vol
    } else {
      fill += vol
    }
  }

  return { cut, fill, net: cut - fill }
}

/**
 * Compute volume between two TIN surfaces (e.g., before/after for earthworks).
 *
 * Samples the difference at a grid and integrates numerically.
 */
export function computeVolumeBetweenSurfaces(
  surface1: TINSurface,
  surface2: TINSurface,
  gridSpacing: number = 1.0
): { cut: number; fill: number; net: number } {
  const minE = Math.max(surface1.bounds.minE, surface2.bounds.minE)
  const maxE = Math.min(surface1.bounds.maxE, surface2.bounds.maxE)
  const minN = Math.max(surface1.bounds.minN, surface2.bounds.minN)
  const maxN = Math.min(surface1.bounds.maxN, surface2.bounds.maxN)

  if (minE >= maxE || minN >= maxN) return { cut: 0, fill: 0, net: 0 }

  let cut = 0
  let fill = 0
  const cellArea = gridSpacing * gridSpacing

  for (let e = minE; e <= maxE; e += gridSpacing) {
    for (let n = minN; n <= maxN; n += gridSpacing) {
      const z1 = interpolateElevation(surface1, e, n)
      const z2 = interpolateElevation(surface2, e, n)

      if (z1 === null || z2 === null) continue

      const diff = z1 - z2
      if (diff > 0) {
        cut += diff * cellArea
      } else {
        fill += Math.abs(diff) * cellArea
      }
    }
  }

  return { cut, fill, net: cut - fill }
}

/**
 * Generate a small demo set of spot heights for the 3D viewer
 * (a 10x10 grid with a smooth bump + noise around an origin).
 */
export function generateDemoData(): SpotHeight[] {
  const points: SpotHeight[] = []
  const cx = 500000
  const cy = 0
  const step = 5
  const n = 10
  let idx = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const easting = cx + (i - n / 2) * step
      const northing = cy + (j - n / 2) * step
      const r = Math.sqrt((i - n / 2) ** 2 + (j - n / 2) ** 2)
      const bump = Math.max(0, 20 - r * 2)
      const elevation = 100 + bump + Math.sin(i * 0.6) * 0.5 + Math.cos(j * 0.5) * 0.5
      points.push({ name: `P${idx++}`, easting, northing, elevation })
    }
  }
  return points
}
