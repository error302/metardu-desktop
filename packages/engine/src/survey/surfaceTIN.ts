/**
 * Surface TIN Builder + Cut/Fill Volume — grid-based earthworks
 *
 * PROBLEM
 * -------
 * The existing earthworksEngine.ts computes volumes via the end-area method
 * (cross-section by cross-section). This is accurate for regular road
 * templates but doesn't handle irregular surfaces (stockpiles, borrow pits,
 * dam foundations, complex interchanges).
 *
 * This module builds a TIN (Triangulated Irregular Network) from a point
 * cloud using Delaunay triangulation, then computes cut/fill volumes
 * between two surfaces (design vs as-built) by sampling a regular grid.
 *
 * WHAT IT DOES
 * ------------
 * 1. buildTIN(points) → TIN with triangles
 * 2. interpolateZ(tin, x, y) → height at any point
 * 3. computeCutFill(designTIN, groundTIN, gridSpacing) → { cut, fill, net }
 *
 * USAGE
 * -----
 *   import { buildTIN, computeCutFill } from '@/lib/survey/surfaceTIN'
 *
 *   const groundTIN = buildTIN(surveyPoints)
 *   const designTIN = buildTIN(designPoints)
 *   const { cutVolume, fillVolume, netVolume } = computeCutFill(designTIN, groundTIN, 5.0)
 *   // cutVolume = 1200.5 m³, fillVolume = 340.2 m³, netVolume = 860.3 m³ (cut)
 */

import Delaunator from 'delaunator'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SurfacePoint {
  x: number  // Easting
  y: number  // Northing
  z: number  // Height/RL
}

export interface Triangle {
  a: number  // index into points array
  b: number
  c: number
}

export interface TIN {
  points: SurfacePoint[]
  triangles: Triangle[]
  /** Bounding box */
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface CutFillResult {
  /** Volume of material to remove (ground above design) — m³ */
  cutVolume: number
  /** Volume of material to add (ground below design) — m³ */
  fillVolume: number
  /** Net volume: cut - fill (positive = net cut, negative = net fill) — m³ */
  netVolume: number
  /** Grid spacing used (meters) */
  gridSpacing: number
  /** Number of grid cells sampled */
  cellCount: number
  /** Area covered (m²) */
  area: number
  /** Average cut depth (meters) */
  avgCutDepth: number
  /** Average fill depth (meters) */
  avgFillDepth: number
  /** Per-cell results (for heat map visualization) */
  cells: CutFillCell[]
}

export interface CutFillCell {
  x: number  // center of cell
  y: number
  designZ: number
  groundZ: number
  diff: number  // ground - design (positive = cut, negative = fill)
  volume: number  // m³ (positive = cut, negative = fill)
}

// ─── TIN Builder ────────────────────────────────────────────────────────────

/**
 * Build a TIN (Triangulated Irregular Network) from a point cloud.
 *
 * Uses the Delaunator library for Delaunay triangulation.
 *
 * @param points - Array of 3D points (x=easting, y=northing, z=height)
 * @returns TIN with triangles
 */
export function buildTIN(points: SurfacePoint[]): TIN {
  if (points.length < 3) {
    throw new Error('TIN requires at least 3 points')
  }

  // Extract 2D coordinates for Delaunator
  const coords: number[] = []
  for (const p of points) {
    coords.push(p.x, p.y)
  }

  // Use Delaunator (already in package.json)
  // T1.5i FIX (2026-07-10): Replaced require() with a proper ES import at the
  // top of the file. The CommonJS require() worked in jest but breaks in the
  // Next.js browser bundler.
  const delaunay = new Delaunator(coords)
  const triangles: Triangle[] = []

  for (let i = 0; i < delaunay.triangles.length; i += 3) {
    triangles.push({
      a: delaunay.triangles[i],
      b: delaunay.triangles[i + 1],
      c: delaunay.triangles[i + 2],
    })
  }

  // Bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }

  return { points, triangles, minX, maxX, minY, maxY }
}

// ─── Interpolation ──────────────────────────────────────────────────────────

/**
 * Interpolate the Z value at a given (x, y) position within a TIN.
 *
 * Uses barycentric interpolation within the containing triangle.
 * Returns null if the point is outside the TIN's convex hull.
 */
export function interpolateZ(tin: TIN, x: number, y: number): number | null {
  // Find the triangle containing this point
  for (const tri of tin.triangles) {
    const a = tin.points[tri.a]
    const b = tin.points[tri.b]
    const c = tin.points[tri.c]

    if (pointInTriangle(x, y, a, b, c)) {
      // Barycentric interpolation
      const denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y)
      if (Math.abs(denom) < 1e-12) return a.z

      const l1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denom
      const l2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denom
      const l3 = 1 - l1 - l2

      return l1 * a.z + l2 * b.z + l3 * c.z
    }
  }

  return null // outside convex hull
}

/**
 * Check if a point is inside a triangle (using barycentric coordinates).
 */
function pointInTriangle(
  x: number, y: number,
  a: SurfacePoint, b: SurfacePoint, c: SurfacePoint,
): boolean {
  const d1 = sign(x, y, a, b)
  const d2 = sign(x, y, b, c)
  const d3 = sign(x, y, c, a)

  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0

  return !(hasNeg && hasPos)
}

function sign(
  px: number, py: number,
  a: SurfacePoint, b: SurfacePoint,
): number {
  return (px - b.x) * (a.y - b.y) - (a.x - b.x) * (py - b.y)
}

// ─── Cut/Fill Volume Computation ────────────────────────────────────────────

/**
 * Compute cut/fill volumes between a design surface and a ground (as-built)
 * surface.
 *
 * Uses a grid-based method:
 *   1. Overlay a regular grid on the overlapping area
 *   2. At each grid cell, interpolate the height from both TINs
 *   3. Compute the difference (ground - design)
 *   4. Multiply by cell area to get volume
 *
 * Positive difference = CUT (ground is above design, material to remove)
 * Negative difference = FILL (ground is below design, material to add)
 *
 * @param designTIN - The design surface
 * @param groundTIN - The surveyed/as-built ground surface
 * @param gridSpacing - Grid cell size in meters (default: 5.0)
 * @returns CutFillResult with volumes + per-cell data for heat maps
 */
export function computeCutFill(
  designTIN: TIN,
  groundTIN: TIN,
  gridSpacing: number = 5.0,
): CutFillResult {
  // Find the overlapping bounding box
  const minX = Math.max(designTIN.minX, groundTIN.minX)
  const maxX = Math.min(designTIN.maxX, groundTIN.maxX)
  const minY = Math.max(designTIN.minY, groundTIN.minY)
  const maxY = Math.min(designTIN.maxY, groundTIN.maxY)

  if (minX >= maxX || minY >= maxY) {
    return {
      cutVolume: 0,
      fillVolume: 0,
      netVolume: 0,
      gridSpacing,
      cellCount: 0,
      area: 0,
      avgCutDepth: 0,
      avgFillDepth: 0,
      cells: [],
    }
  }

  const cellArea = gridSpacing * gridSpacing
  const cells: CutFillCell[] = []
  let cutVolume = 0
  let fillVolume = 0
  let cutCount = 0
  let fillCount = 0
  let cutDepthSum = 0
  let fillDepthSum = 0

  // Sample at grid cell centers
  for (let x = minX + gridSpacing / 2; x < maxX; x += gridSpacing) {
    for (let y = minY + gridSpacing / 2; y < maxY; y += gridSpacing) {
      const designZ = interpolateZ(designTIN, x, y)
      const groundZ = interpolateZ(groundTIN, x, y)

      if (designZ === null || groundZ === null) continue

      const diff = groundZ - designZ // positive = cut, negative = fill
      const volume = diff * cellArea

      cells.push({ x, y, designZ, groundZ, diff, volume })

      if (diff > 0) {
        cutVolume += volume
        cutDepthSum += diff
        cutCount++
      } else if (diff < 0) {
        fillVolume += Math.abs(volume)
        fillDepthSum += Math.abs(diff)
        fillCount++
      }
    }
  }

  const cellCount = cells.length
  const area = cellCount * cellArea

  return {
    cutVolume,
    fillVolume,
    netVolume: cutVolume - fillVolume,
    gridSpacing,
    cellCount,
    area,
    avgCutDepth: cutCount > 0 ? cutDepthSum / cutCount : 0,
    avgFillDepth: fillCount > 0 ? fillDepthSum / fillCount : 0,
    cells,
  }
}

// ─── Stockpile/Borrow Pit Volume ────────────────────────────────────────────

/**
 * Compute the volume of a stockpile or borrow pit from a single surface
 * survey, relative to a reference datum.
 *
 * @param tin - The surveyed surface
 * @param datumRL - The reference level (e.g., original ground level)
 * @param gridSpacing - Grid cell size (default: 2.0m for stockpiles)
 * @returns Volume above datum (stockpile) or below datum (borrow pit)
 */
export function computeStockpileVolume(
  tin: TIN,
  datumRL: number,
  gridSpacing: number = 2.0,
): { volume: number; area: number; avgHeight: number; cellCount: number } {
  let volume = 0
  let cellCount = 0
  let heightSum = 0

  for (let x = tin.minX + gridSpacing / 2; x < tin.maxX; x += gridSpacing) {
    for (let y = tin.minY + gridSpacing / 2; y < tin.maxY; y += gridSpacing) {
      const z = interpolateZ(tin, x, y)
      if (z === null) continue

      const height = z - datumRL
      volume += height * gridSpacing * gridSpacing
      heightSum += height
      cellCount++
    }
  }

  return {
    volume,
    area: cellCount * gridSpacing * gridSpacing,
    avgHeight: cellCount > 0 ? heightSum / cellCount : 0,
    cellCount,
  }
}
