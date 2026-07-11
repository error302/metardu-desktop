/**
 * @module topologyChecker
 *
 * Real-time topology validation for cadastral surveying.
 *
 * Detects:
 * 1. Parcel overlap — new boundary intersects an existing parcel
 * 2. Sliver polygons — micro-gaps between adjacent plots (< 0.5m wide)
 * 3. Self-intersection — boundary crosses itself
 * 4. Road reserve encroachment — boundary intersects a road reserve buffer
 * 5. Duplicate beacons — two beacons at nearly the same coordinate
 *
 * Uses @turf/turf for geometric operations, operating on EPSG:21037
 * coordinates via the existing turfHelpers module.
 *
 * All functions are async (turf + proj4 are lazy-loaded).
 */

import {
  polygonToTurf,
  lineStringToTurf,
  toTurfCoord,
  type SurveyPoint,
} from '@/lib/map/turfHelpers'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TopologyIssueSeverity = 'error' | 'warning' | 'info'

export interface TopologyIssue {
  id: string
  type:
    | 'overlap'
    | 'sliver'
    | 'self_intersection'
    | 'road_encroachment'
    | 'duplicate_beacon'
    | 'unclosed_polygon'
    | 'insufficient_vertices'
  severity: TopologyIssueSeverity
  message: string
  details?: string
  /** Affected coordinates (for map highlighting) */
  coordinates?: SurveyPoint[]
  /** Overlapping parcel identifier (if applicable) */
  conflictingParcelId?: string
}

export interface TopologyCheckResult {
  issues: TopologyIssue[]
  isValid: boolean
  hasErrors: boolean
  hasWarnings: boolean
}

export interface ExistingParcel {
  id: string
  name?: string
  vertices: SurveyPoint[]
}

export interface RoadReserve {
  id: string
  name?: string
  /** Centerline vertices of the road */
  centerline: SurveyPoint[]
  /** Reserve width in meters (total, both sides) */
  widthM: number
}

// ---------------------------------------------------------------------------
// Lazy turf accessor
// ---------------------------------------------------------------------------

let _turf: any = null

async function getTurf(): Promise<any> {
  if (!_turf) {
    const mod = await import('@turf/turf')
    _turf = mod
  }
  return _turf
}

// ---------------------------------------------------------------------------
// Validation Functions
// ---------------------------------------------------------------------------

/**
 * Check if a polygon boundary self-intersects.
 *
 * A self-intersection occurs when two non-adjacent edges of the polygon
 * cross each other. This produces an invalid parcel that will be rejected
 * by the registry.
 *
 * @param vertices - Parcel boundary vertices (EPSG:21037).
 * @returns Array of intersection points (empty if no self-intersection).
 */
export async function checkSelfIntersection(
  vertices: SurveyPoint[],
): Promise<SurveyPoint[]> {
  if (vertices.length < 4) return []

  const turf = await getTurf()

  // Create a linestring from the polygon boundary
  const line = await lineStringToTurf(vertices)

  // Use turf's kinks function to find self-intersections
  const kinks = turf.kinks(line)

  if (!kinks || !kinks.features || kinks.features.length === 0) {
    return []
  }

  // Convert intersection points back to EPSG:21037
  const { fromTurfCoord } = await import('@/lib/map/turfHelpers')
  const intersections: SurveyPoint[] = []
  for (const feature of kinks.features) {
    const [lon, lat] = feature.geometry.coordinates
    const pt = await fromTurfCoord([lon, lat])
    intersections.push(pt)
  }

  return intersections
}

/**
 * Check if a new parcel overlaps any existing parcels.
 *
 * @param newVertices - The new parcel boundary (EPSG:21037).
 * @param existingParcels - Array of existing parcels to check against.
 * @param toleranceSqM - Overlap area threshold in m² (default: 1 m²).
 *                       Overlaps smaller than this are ignored (survey noise).
 * @returns Array of issues, one per conflicting parcel.
 */
export async function checkParcelOverlap(
  newVertices: SurveyPoint[],
  existingParcels: ExistingParcel[],
  toleranceSqM: number = 1,
): Promise<TopologyIssue[]> {
  if (newVertices.length < 3 || existingParcels.length === 0) return []

  const turf = await getTurf()
  const newPoly = await polygonToTurf(newVertices)
  const issues: TopologyIssue[] = []

  for (const existing of existingParcels) {
    if (existing.vertices.length < 3) continue

    try {
      const existingPoly = await polygonToTurf(existing.vertices)
      const intersection = turf.intersect(newPoly, existingPoly)

      if (intersection) {
        const overlapArea = turf.area(intersection)

        if (overlapArea > toleranceSqM) {
          issues.push({
            id: `overlap-${existing.id}`,
            type: 'overlap',
            severity: 'error',
            message: `Parcel overlaps "${existing.name || existing.id}"`,
            details: `Overlap area: ${overlapArea.toFixed(2)} m² (${(overlapArea / 10000).toFixed(4)} ha). This will cause registry rejection.`,
            conflictingParcelId: existing.id,
          })
        }
      }
    } catch (err) {
      // Skip malformed parcels
      continue
    }
  }

  return issues
}

/**
 * Detect sliver polygons — micro-gaps between adjacent parcels.
 *
 * A sliver is a thin strip of unclaimed land between two parcels that
 * should share a boundary. These frequently break automated registration.
 *
 * @param newVertices - The new parcel boundary.
 * @param existingParcels - Adjacent existing parcels.
 * @param thresholdM - Maximum gap width to flag as a sliver (default: 0.5m).
 * @returns Array of sliver issues.
 */
export async function checkSliverPolygons(
  newVertices: SurveyPoint[],
  existingParcels: ExistingParcel[],
  thresholdM: number = 0.5,
): Promise<TopologyIssue[]> {
  if (newVertices.length < 3 || existingParcels.length === 0) return []

  const turf = await getTurf()
  const issues: TopologyIssue[] = []

  // Buffer the new parcel by the threshold distance
  const newPoly = await polygonToTurf(newVertices)
  const bufferedNew = turf.buffer(newPoly, thresholdM, { units: 'meters' })

  for (const existing of existingParcels) {
    if (existing.vertices.length < 3) continue

    try {
      const existingPoly = await polygonToTurf(existing.vertices)

      // Check if the buffered new parcel overlaps the existing parcel
      // but the original doesn't (this indicates a gap < thresholdM)
      const bufferedIntersection = turf.intersect(bufferedNew, existingPoly)
      const directIntersection = turf.intersect(newPoly, existingPoly)

      if (bufferedIntersection && !directIntersection) {
        // There's a gap between the parcels that's smaller than thresholdM
        const gapArea = turf.area(bufferedIntersection)

        if (gapArea > 0.01 && gapArea < thresholdM * 100) {
          issues.push({
            id: `sliver-${existing.id}`,
            type: 'sliver',
            severity: 'warning',
            message: `Sliver gap detected with "${existing.name || existing.id}"`,
            details: `Gap width < ${thresholdM}m. This micro-gap will cause registration issues. Snap boundaries to eliminate the gap.`,
            conflictingParcelId: existing.id,
          })
        }
      }
    } catch (err) {
      continue
    }
  }

  return issues
}

/**
 * Check if a parcel boundary encroaches on a road reserve.
 *
 * Road reserves in Kenya are typically 15m wide (7.5m each side from
 * centerline) for rural roads, and 30m for highways.
 *
 * @param newVertices - The new parcel boundary.
 * @param roadReserves - Array of road reserves to check.
 * @returns Array of encroachment issues.
 */
export async function checkRoadReserveEncroachment(
  newVertices: SurveyPoint[],
  roadReserves: RoadReserve[],
): Promise<TopologyIssue[]> {
  if (newVertices.length < 3 || roadReserves.length === 0) return []

  const turf = await getTurf()
  const issues: TopologyIssue[] = []
  const newPoly = await polygonToTurf(newVertices)

  for (const road of roadReserves) {
    if (road.centerline.length < 2) continue

    try {
      // Create the road reserve polygon by buffering the centerline
      const centerline = await lineStringToTurf(road.centerline)
      const halfWidth = road.widthM / 2
      const reservePoly = turf.buffer(centerline, halfWidth, { units: 'meters' })

      if (!reservePoly) continue

      // Check intersection
      const intersection = turf.intersect(newPoly, reservePoly)

      if (intersection) {
        const encroachmentArea = turf.area(intersection)

        if (encroachmentArea > 0.5) {
          issues.push({
            id: `road-${road.id}`,
            type: 'road_encroachment',
            severity: 'error',
            message: `Encroaches on road reserve "${road.name || road.id}"`,
            details: `Encroachment area: ${encroachmentArea.toFixed(2)} m². Road reserve width: ${road.widthM}m. This is illegal under the Roads Act.`,
            conflictingParcelId: road.id,
          })
        }
      }
    } catch (err) {
      continue
    }
  }

  return issues
}

/**
 * Detect duplicate beacons — two beacons at nearly the same coordinate.
 *
 * Duplicate beacons cause confusion in the registry and may indicate
 * a data entry error or a beacon that was re-established without
 * cancelling the old one.
 *
 * @param beacons - Array of beacon coordinates.
 * @param thresholdM - Maximum distance to consider beacons duplicates (default: 0.1m).
 * @returns Array of duplicate beacon issues.
 */
export async function checkDuplicateBeacons(
  beacons: SurveyPoint[],
  thresholdM: number = 0.1,
): Promise<TopologyIssue[]> {
  if (beacons.length < 2) return []

  const issues: TopologyIssue[] = []
  const thresholdSq = thresholdM * thresholdM

  for (let i = 0; i < beacons.length; i++) {
    for (let j = i + 1; j < beacons.length; j++) {
      const dE = beacons[i].easting - beacons[j].easting
      const dN = beacons[i].northing - beacons[j].northing
      const distSq = dE * dE + dN * dN

      if (distSq < thresholdSq) {
        const dist = Math.sqrt(distSq)
        issues.push({
          id: `dup-beacon-${i}-${j}`,
          type: 'duplicate_beacon',
          severity: 'warning',
          message: `Duplicate beacons detected`,
          details: `Beacons ${i + 1} and ${j + 1} are ${dist.toFixed(3)}m apart. Threshold: ${thresholdM}m. Verify if these are the same physical beacon.`,
          coordinates: [beacons[i], beacons[j]],
        })
      }
    }
  }

  return issues
}

/**
 * Run a comprehensive topology check on a new parcel.
 *
 * This is the main entry point for real-time validation.
 * It runs all checks and returns a combined result.
 *
 * @param params - Check parameters.
 * @returns Combined topology check result.
 */
export async function runTopologyCheck(params: {
  newVertices: SurveyPoint[]
  existingParcels?: ExistingParcel[]
  roadReserves?: RoadReserve[]
  beacons?: SurveyPoint[]
  sliverThresholdM?: number
  overlapToleranceSqM?: number
  duplicateBeaconThresholdM?: number
}): Promise<TopologyCheckResult> {
  const {
    newVertices,
    existingParcels = [],
    roadReserves = [],
    beacons = [],
    sliverThresholdM = 0.5,
    overlapToleranceSqM = 1,
    duplicateBeaconThresholdM = 0.1,
  } = params

  const issues: TopologyIssue[] = []

  // 1. Check minimum vertices
  if (newVertices.length < 3) {
    issues.push({
      id: 'insufficient-vertices',
      type: 'insufficient_vertices',
      severity: 'error',
      message: 'Insufficient vertices',
      details: 'A parcel requires at least 3 vertices to form a valid polygon.',
    })
    return { issues, isValid: false, hasErrors: true, hasWarnings: false }
  }

  // 2. Check if polygon is closed
  if (newVertices.length >= 3) {
    const first = newVertices[0]
    const last = newVertices[newVertices.length - 1]
    const distSq = (first.easting - last.easting) ** 2 + (first.northing - last.northing) ** 2
    if (distSq > 0.01) {
      issues.push({
        id: 'unclosed-polygon',
        type: 'unclosed_polygon',
        severity: 'warning',
        message: 'Polygon is not closed',
        details: 'The first and last vertices differ. The polygon will be auto-closed for computation.',
      })
    }
  }

  // 3. Self-intersection check
  const selfIntersections = await checkSelfIntersection(newVertices)
  if (selfIntersections.length > 0) {
    issues.push({
      id: 'self-intersection',
      type: 'self_intersection',
      severity: 'error',
      message: 'Boundary self-intersects',
      details: `${selfIntersections.length} self-intersection point(s) detected. The boundary crosses itself, producing an invalid parcel.`,
      coordinates: selfIntersections,
    })
  }

  // 4. Overlap check
  const overlapIssues = await checkParcelOverlap(newVertices, existingParcels, overlapToleranceSqM)
  issues.push(...overlapIssues)

  // 5. Sliver check
  const sliverIssues = await checkSliverPolygons(newVertices, existingParcels, sliverThresholdM)
  issues.push(...sliverIssues)

  // 6. Road reserve check
  const roadIssues = await checkRoadReserveEncroachment(newVertices, roadReserves)
  issues.push(...roadIssues)

  // 7. Duplicate beacon check
  if (beacons.length >= 2) {
    const dupIssues = await checkDuplicateBeacons(beacons, duplicateBeaconThresholdM)
    issues.push(...dupIssues)
  }

  const hasErrors = issues.some(i => i.severity === 'error')
  const hasWarnings = issues.some(i => i.severity === 'warning')
  const isValid = !hasErrors

  return { issues, isValid, hasErrors, hasWarnings }
}
