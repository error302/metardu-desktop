/**
 * @module chainageCalculator
 *
 * Dynamic Highway Chainage Calculator (Linear Referencing System)
 *
 * Uses OpenLayers LineString.getClosestPoint() to compute:
 * 1. Chainage (station) — distance along the centerline from start
 * 2. Offset — perpendicular distance from centerline to rover
 * 3. Side — Left or Right of the alignment (determinant check)
 *
 * Used for KeNHA corridor audits where assets are referenced by
 * chainage (e.g., Station KM 14+420) and offset, not coordinates.
 *
 * Reference: "Route Surveying" by Meyer & Gibson, Chapter 4
 */

import type { LineString } from 'ol/geom'
import type { Coordinate } from 'ol/coordinate'

export interface ChainageResult {
  /** Chainage in meters from start of alignment (e.g., 14420 = KM 14+420) */
  chainage: number
  /** Formatted chainage string (e.g., "KM 14+420") */
  chainageLabel: string
  /** Perpendicular offset from centerline in meters */
  offset: number
  /** Which side of the alignment: 'left' or 'right' (facing forward) */
  side: 'left' | 'right' | 'on_centerline'
  /** Closest point on the centerline */
  closestPoint: Coordinate
  /** The segment index where the closest point falls */
  segmentIndex: number
  /** Direction (bearing) of the centerline at the closest point */
  alignmentBearing: number
}

/**
 * Calculate chainage, offset, and side for a position relative to a road centerline.
 *
 * @param centerline - OpenLayers LineString geometry of the road centerline
 * @param position - Current rover position [easting, northing] in map projection
 * @returns Chainage result with station, offset, side, and bearing
 */
export function calculateChainage(
  centerline: LineString,
  position: Coordinate,
): ChainageResult | null {
  const coords = centerline.getCoordinates()
  if (coords.length < 2) return null

  // Find closest point on the centerline
  const closestPoint = centerline.getClosestPoint(position) as Coordinate

  // Compute chainage: distance from start to closest point along the line
  let chainage = 0
  let segmentIndex = 0
  let alignmentBearing = 0
  let foundSegment = false

  for (let i = 0; i < coords.length - 1; i++) {
    const segStart = coords[i]
    const segEnd = coords[i + 1]

    // Check if closest point is on this segment
    const segLength = Math.sqrt(
      Math.pow(segEnd[0] - segStart[0], 2) +
      Math.pow(segEnd[1] - segStart[1], 2)
    )

    if (segLength < 1e-10) continue

    // Project closestPoint onto this segment
    const t = ((closestPoint[0] - segStart[0]) * (segEnd[0] - segStart[0]) +
               (closestPoint[1] - segStart[1]) * (segEnd[1] - segStart[1])) /
              (segLength * segLength)

    if (t >= -0.001 && t <= 1.001) {
      // Closest point is on this segment
      const distToStart = Math.sqrt(
        Math.pow(closestPoint[0] - segStart[0], 2) +
        Math.pow(closestPoint[1] - segStart[1], 2)
      )
      chainage += distToStart
      segmentIndex = i
      foundSegment = true

      // Bearing of this segment
      alignmentBearing = Math.atan2(
        segEnd[0] - segStart[0],
        segEnd[1] - segStart[1]
      ) * 180 / Math.PI
      if (alignmentBearing < 0) alignmentBearing += 360

      break
    }

    // Add full segment length to chainage
    chainage += segLength
  }

  if (!foundSegment) {
    // Fallback: use total distance to closest point
    chainage = centerline.getLength()
  }

  // Compute offset (perpendicular distance)
  const offset = Math.sqrt(
    Math.pow(position[0] - closestPoint[0], 2) +
    Math.pow(position[1] - closestPoint[1], 2)
  )

  // Determine side (left or right) using cross product
  // If alignment goes from A to B, and rover is at P:
  // cross = (B.x - A.x) * (P.y - A.y) - (B.y - A.y) * (P.x - A.x)
  // cross > 0: P is to the LEFT of the alignment
  // cross < 0: P is to the RIGHT of the alignment
  let side: 'left' | 'right' | 'on_centerline' = 'on_centerline'

  if (offset > 0.1) {
    const segStart = coords[segmentIndex]
    const segEnd = coords[Math.min(segmentIndex + 1, coords.length - 1)]

    const cross = (segEnd[0] - segStart[0]) * (position[1] - segStart[1]) -
                  (segEnd[1] - segStart[1]) * (position[0] - segStart[0])

    side = cross > 0 ? 'left' : 'right'
  }

  return {
    chainage,
    chainageLabel: formatChainage(chainage),
    offset,
    side,
    closestPoint,
    segmentIndex,
    alignmentBearing,
  }
}

/**
 * Format chainage in Kenya road convention: KM XX+XXX
 * e.g., 14420 → "KM 14+420"
 *       350 → "KM 0+350"
 *       1234.56 → "KM 1+234.56"
 */
export function formatChainage(chainageM: number): string {
  const km = Math.floor(chainageM / 1000)
  const m = chainageM % 1000
  return `KM ${km}+${m.toFixed(m < 100 ? 1 : 0).padStart(m < 100 ? 5 : 4, '0')}`
}

/**
 * Parse a chainage label back to meters.
 * e.g., "KM 14+420" → 14420
 *       "14+420" → 14420
 */
export function parseChainage(label: string): number | null {
  const cleaned = label.replace(/KM/i, '').trim()
  const match = cleaned.match(/^(\d+)\+(\d+(?:\.\d+)?)$/)
  if (match) {
    return parseInt(match[1]) * 1000 + parseFloat(match[2])
  }
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

/**
 * Generate chainage ticks along a centerline at regular intervals.
 *
 * @param centerline - OpenLayers LineString
 * @param interval - meters between ticks (default 1000 = every KM)
 * @returns Array of { chainage, coordinate } for each tick
 */
export function generateChainageTicks(
  centerline: LineString,
  interval: number = 1000,
): Array<{ chainage: number; label: string; coordinate: Coordinate }> {
  const coords = centerline.getCoordinates()
  const ticks: Array<{ chainage: number; label: string; coordinate: Coordinate }> = []

  let accumulated = 0
  let nextTick = 0

  ticks.push({ chainage: 0, label: formatChainage(0), coordinate: coords[0] })

  for (let i = 0; i < coords.length - 1; i++) {
    const segStart = coords[i]
    const segEnd = coords[i + 1]
    const segLength = Math.sqrt(
      Math.pow(segEnd[0] - segStart[0], 2) +
      Math.pow(segEnd[1] - segStart[1], 2)
    )

    while (nextTick + interval <= accumulated + segLength) {
      nextTick += interval
      const t = (nextTick - accumulated) / segLength
      const tickCoord: Coordinate = [
        segStart[0] + t * (segEnd[0] - segStart[0]),
        segStart[1] + t * (segEnd[1] - segStart[1]),
      ]
      ticks.push({
        chainage: nextTick,
        label: formatChainage(nextTick),
        coordinate: tickCoord,
      })
    }

    accumulated += segLength
  }

  return ticks
}

/**
 * Find assets near a chainage station.
 *
 * @param assets - Array of { chainage, offset, description }
 * @param targetChainage - Chainage to search around
 * @param range - Search range in meters (default 100m)
 */
export function findAssetsNearChainage<T extends { chainage: number }>(
  assets: T[],
  targetChainage: number,
  range: number = 100,
): Array<T & { distanceFromTarget: number }> {
  return assets
    .map(asset => ({
      ...asset,
      distanceFromTarget: Math.abs(asset.chainage - targetChainage),
    }))
    .filter(asset => asset.distanceFromTarget <= range)
    .sort((a, b) => a.distanceFromTarget - b.distanceFromTarget)
}
