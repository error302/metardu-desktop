/**
 * COGO Deed Plan Reconstructor — v0.3
 *
 * Reconstructs boundary geometry from historical paper deed plans that list
 * bearings and distances (not coordinates). Old mutation forms and paper deed
 * plans use DMS bearings (e.g., N 45°12'30" E, 120.4 m) — this converts them
 * to UTM coordinates.
 *
 * Math:
 *   Bearing in DMS → decimal azimuth (α) → radians
 *   ΔE = distance × sin(α)
 *   ΔN = distance × cos(α)
 *   Start from known point, accumulate deltas
 *
 * Includes "swing & scale" transformation: once the reconstructed boundary
 * is placed, the surveyor can anchor one point to a known control beacon and
 * rotate/scale the entire boundary to snap onto the real-world control network.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type BearingFormat = 'WCB' | 'quadrant'

export interface DeedLeg {
  id: string
  /** Bearing in DMS — for WCB: degrees only (0-360). For quadrant: degrees + quadrant */
  bearingDeg: string
  bearingMin: string
  bearingSec: string
  /** Quadrant: NE, NW, SE, SW (only for quadrant format) */
  quadrant?: 'NE' | 'NW' | 'SE' | 'SW'
  /** Horizontal distance in metres */
  distance: string
  /** Optional description (e.g., "to beacon AB1") */
  description?: string
}

export interface ReconstructedPoint {
  /** Vertex number (1 = starting point) */
  vertex: number
  easting: number
  northing: number
  /** Bearing from previous point (decimal degrees, WCB) */
  bearingFromPrev: number
  /** Distance from previous point (metres) */
  distanceFromPrev: number
  description?: string
}

export interface ReconstructResult {
  points: ReconstructedPoint[]
  /** Closure check: distance from last point back to start */
  miscloseDistance: number
  /** Closure ratio: misclose / total perimeter */
  miscloseRatio: number
  /** Total perimeter in metres */
  perimeter: number
  /** Enclosed area in m² (if closed) */
  area: number
  /** Whether the boundary closes (last point ≈ first point) */
  isClosed: boolean
  /** Boundary as coordinate ring for export */
  coordinates: [number, number][]
}

export interface SwingScaleParams {
  /** Index of the anchor point in the reconstructed boundary */
  anchorIndex: number
  /** Target (known control) coordinates for the anchor */
  targetEasting: number
  targetNorthing: number
  /** Index of a second point for rotation/scale (optional) */
  secondPointIndex?: number
  /** Target coordinates for the second point (if used) */
  secondTargetEasting?: number
  secondTargetNorthing?: number
  /** Rotation angle in degrees (if manual, otherwise computed from second point) */
  manualRotation?: number
  /** Scale factor (if manual, otherwise computed from second point) */
  manualScale?: number
}

export interface SwingScaleResult {
  points: ReconstructedPoint[]
  coordinates: [number, number][]
  rotationApplied: number
  scaleApplied: number
  translationApplied: { dE: number; dN: number }
}

// ─── Bearing parsing ────────────────────────────────────────────────────────

/**
 * Convert DMS bearing to decimal degrees azimuth (WCB, 0-360°).
 *
 * WCB format: just degrees (already 0-360 clockwise from north)
 * Quadrant format: degrees + quadrant letter
 *   NE → bearing as-is (0-90)
 *   SE → 180 - bearing (90-180)
 *   SW → 180 + bearing (180-270)
 *   NW → 360 - bearing (270-360)
 */
export function dmsToAzimuth(
  deg: string,
  min: string,
  sec: string,
  format: BearingFormat,
  quadrant?: 'NE' | 'NW' | 'SE' | 'SW',
): number {
  const d = parseFloat(deg) || 0
  const m = parseFloat(min) || 0
  const s = parseFloat(sec) || 0
  const decimal = d + m / 60 + s / 3600

  if (format === 'WCB') {
    return decimal % 360
  }

  // Quadrant format
  switch (quadrant) {
    case 'NE': return decimal
    case 'SE': return 180 - decimal
    case 'SW': return 180 + decimal
    case 'NW': return 360 - decimal
    default: return decimal
  }
}

// ─── Main reconstruction ────────────────────────────────────────────────────

/**
 * Reconstruct a boundary from a sequence of bearings and distances.
 *
 * @param legs Array of deed legs (bearing + distance)
 * @param startEasting Known starting easting (UTM)
 * @param startNorthing Known starting northing (UTM)
 * @param format Bearing format (WCB or quadrant)
 * @returns Reconstructed boundary with closure check
 */
export function reconstructBoundary(
  legs: DeedLeg[],
  startEasting: number,
  startNorthing: number,
  format: BearingFormat = 'WCB',
): ReconstructResult {
  const points: ReconstructedPoint[] = []
  const coordinates: [number, number][] = []

  let currentE = startEasting
  let currentN = startNorthing
  let perimeter = 0

  // Starting point
  points.push({
    vertex: 1,
    easting: currentE,
    northing: currentN,
    bearingFromPrev: 0,
    distanceFromPrev: 0,
    description: 'Starting point',
  })
  coordinates.push([currentE, currentN])

  // Trace each leg
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]
    const azimuth = dmsToAzimuth(leg.bearingDeg, leg.bearingMin, leg.bearingSec, format, leg.quadrant)
    const distance = parseFloat(leg.distance) || 0

    const rad = (azimuth * Math.PI) / 180
    const dE = distance * Math.sin(rad)
    const dN = distance * Math.cos(rad)

    currentE += dE
    currentN += dN
    perimeter += distance

    points.push({
      vertex: i + 2,
      easting: currentE,
      northing: currentN,
      bearingFromPrev: azimuth,
      distanceFromPrev: distance,
      description: leg.description,
    })
    coordinates.push([currentE, currentN])
  }

  // Closure check
  const miscloseDistance = Math.sqrt(
    (currentE - startEasting) ** 2 + (currentN - startNorthing) ** 2,
  )
  const miscloseRatio = perimeter > 0 ? miscloseDistance / perimeter : 0
  const isClosed = miscloseDistance < 0.01 // 1cm tolerance

  // Area by shoelace (only if closed or near-closed)
  let area = 0
  if (coordinates.length >= 3) {
    for (let i = 0; i < coordinates.length - 1; i++) {
      const [x1, y1] = coordinates[i]
      const [x2, y2] = coordinates[i + 1]
      area += (x1 * y2) - (x2 * y1)
    }
    // Close back to start
    const [xn, yn] = coordinates[coordinates.length - 1]
    area += (xn * startNorthing) - (startEasting * yn)
    area = Math.abs(area / 2)
  }

  return {
    points,
    miscloseDistance,
    miscloseRatio,
    perimeter,
    area,
    isClosed,
    coordinates,
  }
}

// ─── Swing & Scale transformation ───────────────────────────────────────────

/**
 * Transform a reconstructed boundary to snap onto known control points.
 *
 * If secondPointIndex is provided, computes rotation and scale from the
 * two-point fit. Otherwise, uses manualRotation and manualScale (defaults: 0, 1).
 * Always translates the anchor point to the target.
 */
export function swingAndScale(
  result: ReconstructResult,
  params: SwingScaleParams,
): SwingScaleResult {
  const { points: originalPoints, coordinates: originalCoords } = result
  const {
    anchorIndex,
    targetEasting,
    targetNorthing,
    secondPointIndex,
    secondTargetEasting,
    secondTargetNorthing,
  } = params

  if (anchorIndex < 0 || anchorIndex >= originalPoints.length) {
    return {
      points: originalPoints,
      coordinates: originalCoords,
      rotationApplied: 0,
      scaleApplied: 1,
      translationApplied: { dE: 0, dN: 0 },
    }
  }

  // Anchor point in original space
  const anchor = originalPoints[anchorIndex]
  const anchorE = anchor.easting
  const anchorN = anchor.northing

  let rotation = 0
  let scale = 1

  // Two-point fit: compute rotation and scale from anchor → second point
  if (
    secondPointIndex !== undefined &&
    secondTargetEasting !== undefined &&
    secondTargetNorthing !== undefined &&
    secondPointIndex >= 0 &&
    secondPointIndex < originalPoints.length
  ) {
    const second = originalPoints[secondPointIndex]

    // Vector from anchor to second point (original space)
    const origDx = second.easting - anchorE
    const origDy = second.northing - anchorN
    const origDist = Math.sqrt(origDx * origDx + origDy * origDy)
    const origAngle = Math.atan2(origDx, origDy)

    // Vector from target anchor to target second point (target space)
    const targetDx = secondTargetEasting - targetEasting
    const targetDy = secondTargetNorthing - targetNorthing
    const targetDist = Math.sqrt(targetDx * targetDx + targetDy * targetDy)
    const targetAngle = Math.atan2(targetDx, targetDy)

    rotation = ((targetAngle - origAngle) * 180) / Math.PI
    scale = origDist > 0 ? targetDist / origDist : 1
  } else {
    rotation = params.manualRotation || 0
    scale = params.manualScale || 1
  }

  // Apply transformation to all points
  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  const transformedPoints = originalPoints.map(p => {
    // Translate to anchor origin
    const dE = p.easting - anchorE
    const dN = p.northing - anchorN

    // Scale
    const scaledDE = dE * scale
    const scaledDN = dN * scale

    // Rotate
    const rotatedDE = scaledDE * cos - scaledDN * sin
    const rotatedDN = scaledDE * sin + scaledDN * cos

    // Translate to target
    return {
      ...p,
      easting: targetEasting + rotatedDE,
      northing: targetNorthing + rotatedDN,
    }
  })

  const transformedCoords = transformedPoints.map(p => [p.easting, p.northing] as [number, number])

  return {
    points: transformedPoints,
    coordinates: transformedCoords,
    rotationApplied: rotation,
    scaleApplied: scale,
    translationApplied: {
      dE: targetEasting - anchorE,
      dN: targetNorthing - anchorN,
    },
  }
}
