/**
 * TIN (Triangulated Irregular Network) — Pure TypeScript implementation.
 * Uses Delaunator for Delaunay triangulation; no Python dependency.
 *
 * Coordinate system: SRID 21037 (Arc 1960 / UTM Zone 37S) for Kenya.
 */

import Delaunator from 'delaunator'

export interface TINPoint {
  id: string
  x: number   // Easting (SRID 21037)
  y: number   // Northing (SRID 21037)
  z: number   // Elevation (metres)
}

export interface TINTriangle {
  a: TINPoint
  b: TINPoint
  c: TINPoint
  area_m2: number
  centroid: { x: number; y: number; z: number }
}

/**
 * Generate a TIN from a set of 3D survey points using Delaunay triangulation.
 * @param points - Minimum 3 points required.
 * @returns Array of triangles with area and centroid data.
 */
export function generateTIN(points: TINPoint[]): TINTriangle[] {
  if (points.length < 3) {
    throw new Error('TIN requires at least 3 points')
  }

  const coords = points.map(p => [p.x, p.y])
  const delaunay = Delaunator.from(coords)

  const triangles: TINTriangle[] = []
  for (let i = 0; i < delaunay.triangles.length; i += 3) {
    const ai = delaunay.triangles[i]
    const bi = delaunay.triangles[i + 1]
    const ci = delaunay.triangles[i + 2]

    // Skip degenerate triangles (collinear or coincident points)
    const a = points[ai]
    const b = points[bi]
    const c = points[ci]

    // Area via cross product (absolute value / 2)
    const area = Math.abs(
      (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)
    ) / 2

    if (area < 1e-6) continue // Skip near-zero area triangles

    triangles.push({
      a, b, c,
      area_m2: area,
      centroid: {
        x: (a.x + b.x + c.x) / 3,
        y: (a.y + b.y + c.y) / 3,
        z: (a.z + b.z + c.z) / 3,
      },
    })
  }

  return triangles
}

/**
 * Interpolate elevation at a query point using barycentric coordinates within the TIN.
 * Returns null if the point falls outside the convex hull of the triangulation.
 */
export function interpolateElevation(
  triangles: TINTriangle[],
  queryX: number,
  queryY: number
): number | null {
  for (const tri of triangles) {
    const { a, b, c } = tri

    const denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y)
    if (Math.abs(denom) < 1e-10) continue

    const w1 = ((b.y - c.y) * (queryX - c.x) + (c.x - b.x) * (queryY - c.y)) / denom
    const w2 = ((c.y - a.y) * (queryX - c.x) + (a.x - c.x) * (queryY - c.y)) / denom
    const w3 = 1 - w1 - w2

    if (w1 >= 0 && w2 >= 0 && w3 >= 0) {
      return w1 * a.z + w2 * b.z + w3 * c.z
    }
  }
  return null
}

/**
 * Compute total surface area of the TIN mesh.
 */
export function computeSurfaceArea(triangles: TINTriangle[]): number {
  let totalArea = 0
  for (const tri of triangles) {
    // 3D surface area using Heron's formula
    const ab = Math.sqrt((tri.b.x - tri.a.x) ** 2 + (tri.b.y - tri.a.y) ** 2 + (tri.b.z - tri.a.z) ** 2)
    const bc = Math.sqrt((tri.c.x - tri.b.x) ** 2 + (tri.c.y - tri.b.y) ** 2 + (tri.c.z - tri.b.z) ** 2)
    const ca = Math.sqrt((tri.a.x - tri.c.x) ** 2 + (tri.a.y - tri.c.y) ** 2 + (tri.a.z - tri.c.z) ** 2)
    const s = (ab + bc + ca) / 2
    const faceArea = Math.sqrt(Math.max(0, s * (s - ab) * (s - bc) * (s - ca)))
    totalArea += faceArea
  }
  return totalArea
}

/**
 * Compute volume between two TIN surfaces (existing vs design).
 * Uses the prism formula for each pair of overlapping triangles.
 */
export function computeTINVolume(
  existingTriangles: TINTriangle[],
  designTriangles: TINTriangle[]
): { cutVolume: number; fillVolume: number; netVolume: number } {
  let cutVolume = 0
  let fillVolume = 0

  // Simplified: use existing TIN triangles, interpolate design elevation at centroids
  for (const tri of existingTriangles) {
    const { x, y } = tri.centroid
    const existingZ = tri.centroid.z
    const designZ = interpolateElevation(designTriangles, x, y)

    if (designZ === null) continue

    const diff = designZ - existingZ
    const cellVolume = tri.area_m2 * diff

    if (cellVolume > 0) {
      fillVolume += cellVolume
    } else {
      cutVolume += Math.abs(cellVolume)
    }
  }

  return {
    cutVolume,
    fillVolume,
    netVolume: fillVolume - cutVolume,
  }
}
