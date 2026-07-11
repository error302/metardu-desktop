/**
 * Road Reserve Corridor Module
 * Kenya Road Reserve Width Standards (KeNHA)
 * Based on Kenya Roads Act and standard surveying practice
 */

// ────────────────────────────────────────────────────────────
// Kenya Road Reserve Width Standards (KeNHA)
// ────────────────────────────────────────────────────────────

export const ROAD_RESERVE_STANDARDS: Record<
  string,
  {
    class: string
    description: string
    reserveWidthMin: number // metres
    reserveWidthStd: number // metres (standard)
    carriagewayStd: number // metres
    shoulderStd: number // metres
  }
> = {
  A: {
    class: 'A',
    description: 'National Trunk Road',
    reserveWidthMin: 40,
    reserveWidthStd: 60,
    carriagewayStd: 7.0,
    shoulderStd: 2.5,
  },
  B: {
    class: 'B',
    description: 'National Primary Road',
    reserveWidthMin: 30,
    reserveWidthStd: 40,
    carriagewayStd: 7.0,
    shoulderStd: 2.0,
  },
  C: {
    class: 'C',
    description: 'National Secondary Road',
    reserveWidthMin: 25,
    reserveWidthStd: 30,
    carriagewayStd: 6.5,
    shoulderStd: 2.0,
  },
  D: {
    class: 'D',
    description: 'County Trunk Road',
    reserveWidthMin: 20,
    reserveWidthStd: 25,
    carriagewayStd: 6.0,
    shoulderStd: 1.5,
  },
  E: {
    class: 'E',
    description: 'County Secondary Road',
    reserveWidthMin: 15,
    reserveWidthStd: 20,
    carriagewayStd: 5.5,
    shoulderStd: 1.5,
  },
  F: {
    class: 'F',
    description: 'County Access Road',
    reserveWidthMin: 10,
    reserveWidthStd: 15,
    carriagewayStd: 5.0,
    shoulderStd: 1.0,
  },
  G: {
    class: 'G',
    description: 'Special Purpose Road',
    reserveWidthMin: 8,
    reserveWidthStd: 10,
    carriagewayStd: 4.5,
    shoulderStd: 1.0,
  },
}

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface Coordinate {
  easting: number
  northing: number
}

export interface CorridorBoundary {
  leftBoundary: Coordinate[]
  rightBoundary: Coordinate[]
}

export interface ComplianceResult {
  compliant: boolean
  required: number
  proposed: number
  deficit: number
}

export interface ReserveWidthResult {
  min: number
  standard: number
  description: string
  carriagewayStd: number
  shoulderStd: number
}

export interface ParcelOverlapResult {
  isWithin: boolean
  overlapArea: number // sqm
  overlapPercentage: number
}

export interface AcquisitionEstimate {
  totalReserveArea: number // sqm
  newAcquisitionArea: number // sqm
  totalAcres: number
  totalHectares: number
}

export type AcquisitionType = 'full' | 'partial' | 'wayleave' | 'none'

// ────────────────────────────────────────────────────────────
// Functions
// ────────────────────────────────────────────────────────────

/**
 * Get road reserve width requirements for a given road class.
 */
export function getRoadReserveWidth(roadClass: string): ReserveWidthResult {
  const std = ROAD_RESERVE_STANDARDS[roadClass]
  if (!std) {
    return {
      min: 0,
      standard: 0,
      description: 'Unknown road class',
      carriagewayStd: 0,
      shoulderStd: 0,
    }
  }
  return {
    min: std.reserveWidthMin,
    standard: std.reserveWidthStd,
    description: std.description,
    carriagewayStd: std.carriagewayStd,
    shoulderStd: std.shoulderStd,
  }
}

/**
 * Check whether a proposed road reserve width meets the minimum standard.
 */
export function checkRoadReserveCompliance(
  roadClass: string,
  proposedWidth: number,
): ComplianceResult {
  const std = ROAD_RESERVE_STANDARDS[roadClass]
  if (!std) {
    return { compliant: false, required: 0, proposed: proposedWidth, deficit: proposedWidth }
  }
  const deficit = Math.max(0, std.reserveWidthMin - proposedWidth)
  return {
    compliant: proposedWidth >= std.reserveWidthMin,
    required: std.reserveWidthMin,
    proposed: proposedWidth,
    deficit,
  }
}

/**
 * Compute left and right corridor boundaries from centreline points
 * using perpendicular offsets of half the reserve width.
 */
export function computeCorridorBoundary(
  centrelinePoints: Coordinate[],
  reserveWidth: number,
): CorridorBoundary {
  if (centrelinePoints.length < 2) {
    return { leftBoundary: [], rightBoundary: [] }
  }

  const halfWidth = reserveWidth / 2
  const leftBoundary: Coordinate[] = []
  const rightBoundary: Coordinate[] = []

  for (let i = 0; i < centrelinePoints.length; i++) {
    const pt = centrelinePoints[i]

    // Determine the forward direction at this point
    let dx: number
    let dy: number

    if (i === 0) {
      // First point: use direction to next point
      dx = centrelinePoints[1].easting - pt.easting
      dy = centrelinePoints[1].northing - pt.northing
    } else if (i === centrelinePoints.length - 1) {
      // Last point: use direction from previous point
      dx = pt.easting - centrelinePoints[i - 1].easting
      dy = pt.northing - centrelinePoints[i - 1].northing
    } else {
      // Interior point: average of incoming and outgoing
      const dxFwd = centrelinePoints[i + 1].easting - pt.easting
      const dyFwd = centrelinePoints[i + 1].northing - pt.northing
      const dxBack = pt.easting - centrelinePoints[i - 1].easting
      const dyBack = pt.northing - centrelinePoints[i - 1].northing
      dx = dxFwd + dxBack
      dy = dyFwd + dyBack
    }

    const length = Math.sqrt(dx * dx + dy * dy)
    if (length === 0) {
      leftBoundary.push({ easting: pt.easting, northing: pt.northing })
      rightBoundary.push({ easting: pt.easting, northing: pt.northing })
      continue
    }

    // Normalised forward direction
    const ux = dx / length
    const uy = dy / length

    // Perpendicular (90° counter-clockwise for left boundary)
    const perpX = -uy
    const perpY = ux

    leftBoundary.push({
      easting: pt.easting + perpX * halfWidth,
      northing: pt.northing + perpY * halfWidth,
    })

    // Right boundary is opposite perpendicular
    rightBoundary.push({
      easting: pt.easting - perpX * halfWidth,
      northing: pt.northing - perpY * halfWidth,
    })
  }

  return { leftBoundary, rightBoundary }
}

// ────────────────────────────────────────────────────────────
// Polygon helpers
// ────────────────────────────────────────────────────────────

/**
 * Compute the signed area of a simple polygon using the shoelace formula.
 */
function polygonArea(vertices: Coordinate[]): number {
  if (vertices.length < 3) return 0
  let area = 0
  const n = vertices.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += vertices[i].easting * vertices[j].northing
    area -= vertices[j].easting * vertices[i].northing
  }
  return Math.abs(area) / 2
}

/**
 * Build a closed polygon from the corridor boundaries:
 * left forward + right reversed.
 */
function buildCorridorPolygon(
  corridorLeft: Coordinate[],
  corridorRight: Coordinate[],
): Coordinate[] {
  return [
    ...corridorLeft,
    ...corridorRight.slice().reverse(),
  ]
}

/**
 * Compute the area of overlap between a parcel polygon and a corridor polygon
 * using the Sutherland–Hodgman clipping algorithm.
 */
function clipPolygonByPolygon(
  subject: Coordinate[],
  clip: Coordinate[],
): Coordinate[] {
  let output: Coordinate[] = [...subject]

  for (let i = 0; i < clip.length && output.length > 0; i++) {
    if (output.length === 0) break

    const input = [...output]
    output = []

    const edgeStart = clip[i]
    const edgeEnd = clip[(i + 1) % clip.length]

    for (let j = 0; j < input.length; j++) {
      const current = input[j]
      const previous = input[(j + input.length - 1) % input.length]

      const currentInside = isInside(current, edgeStart, edgeEnd)
      const previousInside = isInside(previous, edgeStart, edgeEnd)

      if (currentInside) {
        if (!previousInside) {
          const intersection = lineIntersection(
            previous, current, edgeStart, edgeEnd,
          )
          if (intersection) output.push(intersection)
        }
        output.push(current)
      } else if (previousInside) {
        const intersection = lineIntersection(
          previous, current, edgeStart, edgeEnd,
        )
        if (intersection) output.push(intersection)
      }
    }
  }

  return output
}

function isInside(point: Coordinate, edgeStart: Coordinate, edgeEnd: Coordinate): boolean {
  return (
    (edgeEnd.easting - edgeStart.easting) * (point.northing - edgeStart.northing) -
    (edgeEnd.northing - edgeStart.northing) * (point.easting - edgeStart.easting)
  ) >= 0
}

function lineIntersection(
  p1: Coordinate,
  p2: Coordinate,
  p3: Coordinate,
  p4: Coordinate,
): Coordinate | null {
  const denom =
    (p1.easting - p2.easting) * (p3.northing - p4.northing) -
    (p1.northing - p2.northing) * (p3.easting - p4.easting)

  if (Math.abs(denom) < 1e-10) return null

  const t =
    ((p1.easting - p3.easting) * (p3.northing - p4.northing) -
      (p1.northing - p3.northing) * (p3.easting - p4.easting)) /
    denom

  return {
    easting: p1.easting + t * (p2.easting - p1.easting),
    northing: p1.northing + t * (p2.northing - p1.northing),
  }
}

/**
 * Check whether a parcel overlaps with a road reserve corridor
 * and compute the overlap area and percentage.
 */
export function checkParcelInReserve(
  parcelVertices: Coordinate[],
  corridorLeft: Coordinate[],
  corridorRight: Coordinate[],
): ParcelOverlapResult {
  if (parcelVertices.length < 3 || corridorLeft.length < 2) {
    return { isWithin: false, overlapArea: 0, overlapPercentage: 0 }
  }

  const parcelArea = polygonArea(parcelVertices)
  if (parcelArea === 0) {
    return { isWithin: false, overlapArea: 0, overlapPercentage: 0 }
  }

  const corridorPolygon = buildCorridorPolygon(corridorLeft, corridorRight)
  const clipped = clipPolygonByPolygon(parcelVertices, corridorPolygon)
  const overlapArea = polygonArea(clipped)

  return {
    isWithin: overlapArea > 0,
    overlapArea: Math.round(overlapArea * 100) / 100,
    overlapPercentage: Math.round((overlapArea / parcelArea) * 10000) / 100,
  }
}

/**
 * Estimate land acquisition area for road reserve.
 */
export function estimateAcquisitionArea(
  totalLength: number,
  reserveWidth: number,
  existingRoadWidth: number,
): AcquisitionEstimate {
  const totalReserveArea = totalLength * reserveWidth
  const existingRoadArea = totalLength * existingRoadWidth
  const newAcquisitionArea = Math.max(0, totalReserveArea - existingRoadArea)

  return {
    totalReserveArea: Math.round(totalReserveArea * 100) / 100,
    newAcquisitionArea: Math.round(newAcquisitionArea * 100) / 100,
    totalAcres: Math.round((totalReserveArea / 4046.86) * 100) / 100,
    totalHectares: Math.round((totalReserveArea / 10000) * 100) / 100,
  }
}

/**
 * Determine the type of land acquisition based on overlap and structure type.
 *
 * - full:     >80% of the parcel is within the reserve (or a building is affected)
 * - partial:  20–80% overlap
 * - wayleave: <20% overlap or non-building (utility easement)
 * - none:     no overlap at all
 */
export function determineAcquisitionType(
  overlapPercentage: number,
  isBuilding: boolean,
): AcquisitionType {
  if (overlapPercentage === 0) return 'none'
  if (overlapPercentage > 80 || isBuilding) return 'full'
  if (overlapPercentage >= 20) return 'partial'
  return 'wayleave'
}
